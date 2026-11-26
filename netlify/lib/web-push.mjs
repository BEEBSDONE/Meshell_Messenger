import { createCipheriv, createDecipheriv, createHash, createHmac, ECDH, randomBytes } from 'node:crypto';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { verifyEvent } from 'nostr-tools/pure';
import { unpackEventFromToken, validateEvent as validateHttpAuth } from 'nostr-tools/nip98';

const hexKey = /^[0-9a-f]{64}$/;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = { type: 'json' };
const maxDevices = 12;
const hash = value => createHash('sha256').update(value).digest('hex');
const keyFor = (secret, label) => createHmac('sha256', Buffer.from(secret, 'base64url')).update(label).digest();
const condition = row => row ? { onlyIfMatch: row.etag } : { onlyIfNew: true };
const response = (status, data) => new Response(data ? JSON.stringify(data) : null, {
  status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
});

async function signingKeys(store) {
  const key = 'server/vapid-v1';
  const existing = await store.get(key, json);
  if (existing) return existing;
  const generated = generateVAPIDKeys();
  const write = await store.setJSON(key, generated, { onlyIfNew: true });
  return write.modified ? generated : await store.get(key, json);
}

function validSubscription(input) {
  try {
    if (typeof input?.endpoint !== 'string' || input.endpoint.length > 2048) return false;
    const url = new URL(input.endpoint);
    // This server only connects to browser-operated push services. Never follow redirects.
    const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname.endsWith('.push.services.mozilla.com') ||
      url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
    if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname === '/') return false;
    const { auth, p256dh } = input.keys;
    if (typeof auth !== 'string' || typeof p256dh !== 'string' ||
        !/^[\w-]{22}$/.test(auth) || !/^[\w-]{87}$/.test(p256dh)) return false;
    const point = Buffer.from(p256dh, 'base64url');
    return point.length === 65 && point[0] === 4 && !!ECDH.convertKey(point, 'prime256v1');
  } catch { return false; }
}

function seal(sub, key, device) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(device));
  const { auth, p256dh } = sub.keys;
  const data = Buffer.concat([cipher.update(JSON.stringify({ endpoint: sub.endpoint, keys: { auth, p256dh } })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
function unseal(value, key, device) {
  const buf = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  cipher.setAAD(Buffer.from(device));
  cipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(buf.subarray(28)), cipher.final()]).toString());
}

async function readDevices(store, owner) {
  const { blobs } = await store.list({ prefix: 'devices/' + owner + '/' });
  const rows = await Promise.all(blobs.map(async ({ key }) => {
    const row = await store.getWithMetadata(key, json);
    return row && { ...row, key };
  }));
  return rows.filter(Boolean);
}
function validWrap(event, now) {
  if (event?.kind !== 1059 || !Number.isSafeInteger(event.created_at) || event.created_at > now / 1000 + 300 ||
      event.created_at < now / 1000 - 3 * 86400 || !Array.isArray(event.tags) || event.tags.length !== 1 ||
      event.tags[0]?.[0] !== 'p' || typeof event.tags[0][1] !== 'string' || !hexKey.test(event.tags[0][1]) ||
      typeof event.content !== 'string' || event.content.length < 132 || !/^[A-Za-z0-9+/]+=*$/.test(event.content)) return false;
  try { return verifyEvent(event); } catch { return false; }
}

async function deliver(store, owner, keys, event, send, now) {
  const rows = (await readDevices(store, owner)).filter(row => row.data.ciphertext);
  if (!rows.length) return;
  // A bounded receipt cache coalesces bursts and duplicate requests from competing tabs.
  const key = 'receipts/' + owner;
  const previous = await store.getWithMetadata(key, json);
  const id = keyFor(keys.privateKey, event.id).toString('hex');
  const recent = previous?.data.ids ?? [];
  if (recent.includes(id) || now - (previous?.data.at ?? 0) < 15000) return;
  const claimed = await store.setJSON(key, { at: now, ids: [id, ...recent.slice(0, 31)] }, condition(previous));
  if (!claimed.modified) return;
  await Promise.all(rows.map(async row => {
    const device = row.data.device;
    try {
      const subscription = unseal(row.data.ciphertext, keyFor(keys.privateKey, 'devices-v1'), device);
      await send(subscription, JSON.stringify({ v: 1, device }), {
        TTL: 120, urgency: 'normal', topic: 'meshell-activity', timeout: 6000,
        vapidDetails: { subject: 'https://msg.meshell.io', ...keys },
      });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        // A delayed response for an old endpoint cannot remove its replacement.
        await store.setJSON(row.key, { device, revoked: now }, { onlyIfMatch: row.etag });
      } else console.warn('Web Push delivery could not finish', Number(error.statusCode) || 'transport');
    }
  }));
}

async function manage(store, owner, keys, action, data, now) {
  const device = hash(data.token);
  const rows = await readDevices(store, owner);
  const row = rows.find(item => item.data.device === device);
  if (action === 'revoke') {
    if (!row?.data.ciphertext) return response(204);
    const result = await store.setJSON(row.key, { device, revoked: now }, condition(row));
    return response(result.modified ? 204 : 409);
  }
  if (action === 'renew' && !row?.data.ciphertext) return response(404);
  if (row?.data.revoked) return response(410);
  const value = { device, ciphertext: seal(data.subscription, keyFor(keys.privateKey, 'devices-v1'), device) };
  if (row) {
    const result = await store.setJSON(row.key, value, condition(row));
    return response(result.modified ? 204 : 409);
  }
  // Fixed slots bound fan-out even for simultaneous registrations. A recently revoked
  // slot also rejects replay of its original short-lived signed registration.
  for (let i = 0; i < maxDevices; i++) {
    const key = 'devices/' + owner + '/' + i;
    const slot = rows.find(item => item.key === key);
    if (slot && !(slot.data.revoked < now - 120000)) continue;
    const result = await store.setJSON(key, value, condition(slot));
    if (result.modified) return response(204);
    // Refresh the snapshot before retrying, including concurrent enrollment of the same token.
    return response(409);
  }
  return response(409);
}

export async function handlePush(request, { store, waitUntil, send = sendNotification, now = Date.now() }) {
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();
  if (request.method === 'GET' && action === 'key') {
    const { publicKey } = await signingKeys(store);
    return response(200, { publicKey });
  }
  if (request.method !== 'POST' || !['subscribe', 'revoke', 'renew', 'notify'].includes(action)) return response(404);
  if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) return response(403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return response(415);
  const limit = action === 'notify' ? 1024 * 1024 : 8192;
  if (Number(request.headers.get('content-length')) > limit) return response(413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > limit) return response(413);
  let data;
  try { data = JSON.parse(raw); } catch { return response(400); }
  let pk;
  if (action === 'notify') {
    if (!validWrap(data, now)) return response(400);
    pk = data.tags[0][1];
  } else {
    if (typeof data?.account !== 'string' || typeof data.token !== 'string' ||
        !hexKey.test(data.account) || !tokenPattern.test(data.token)) return response(400);
    pk = data.account;
    if (action !== 'revoke' && !validSubscription(data.subscription)) return response(400);
    if (action === 'subscribe') {
      try {
        const header = request.headers.get('authorization');
        if (!header?.startsWith('Nostr ') || header.length > 4096) return response(401);
        const auth = await unpackEventFromToken(header);
        if (auth.pubkey !== pk || auth.content !== '') return response(401);
        await validateHttpAuth(auth, url.href, 'POST', data);
      } catch { return response(401); }
    }
  }
  const keys = await signingKeys(store);
  const owner = keyFor(keys.privateKey, 'account:' + pk).toString('hex');
  if (action === 'notify') {
    // Give all valid envelopes the same response, whether or not the recipient opted in.
    waitUntil(deliver(store, owner, keys, data, send, now).catch(() => console.warn('Web Push dispatch unavailable')));
    return response(202);
  }
  return manage(store, owner, keys, action, data, now);
}
