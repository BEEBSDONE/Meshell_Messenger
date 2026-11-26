import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID, createHash } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { getToken } from 'nostr-tools/nip98';
import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { handlePush } from '../../netlify/lib/web-push.mjs';

const origin = 'https://messenger.test';
class Store {
  rows = new Map();
  async get(key) { return this.rows.get(key)?.data ?? null; }
  async getWithMetadata(key) { return this.rows.get(key) ?? null; }
  async list({ prefix }) { return { blobs: [...this.rows.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }
  async setJSON(key, data, options) {
    const before = this.rows.get(key);
    if ((options.onlyIfNew && before) || (options.onlyIfMatch && before?.etag !== options.onlyIfMatch)) return { modified: false };
    this.rows.set(key, { data, etag: randomUUID() }); return { modified: true };
  }
}
function subscription() {
  const ec = createECDH('prime256v1');
  return { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/' + randomUUID(),
    keys: { p256dh: ec.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
function fixture() {
  const store = new Store(), sent = [], tasks = [];
  const sk = generateSecretKey(), account = getPublicKey(sk);
  const device = { account, token: randomUUID(), subscription: subscription() };
  let failure = 0;
  async function request(action, body, { signed = body, signer = sk, now = Date.now(), headers = {} } = {}) {
    const url = origin + '/api/push/' + action;
    const auth = signed && await getToken(url, 'POST', template => finalizeEvent(template, signer), true, signed);
    const r = await handlePush(new Request(url, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: auth }), ...headers },
      body: body && JSON.stringify(body) }), { store, now, waitUntil: promise => tasks.push(promise),
      send: async (sub, payload, options) => { sent.push({ sub, payload: JSON.parse(payload), options });
        if (failure) throw Object.assign(Error(), { statusCode: failure }); } });
    return r;
  }
  const gift = (to = account) => {
    const sender = generateSecretKey();
    return createWrap(createSeal(createRumor({ kind: 14, tags: [['p', to]], content: 'private test text' }, sender), sender, to), to);
  };
  return { store, sent, device, request, gift, fail: code => { failure = code; }, drain: () => Promise.all(tasks.splice(0)) };
}

test('VAPID creation is atomic and only the stable public key is returned', async () => {
  const f = fixture();
  const values = await Promise.all(Array.from({ length: 12 }, async () => (await f.request('key')).json()));
  assert.deepEqual(Object.keys(values[0]), ['publicKey']);
  assert.match(values[0].publicKey, /^[\w-]{87}$/);
  assert.equal(new Set(values.map(v => v.publicKey)).size, 1);
});

test('enrollment verifies NIP-98 ownership, method, origin, body, and browser push provider', async () => {
  const { device, request, store } = fixture();
  assert.equal((await request('subscribe', device, { signed: null })).status, 401);
  assert.equal((await request('subscribe', device, { signer: generateSecretKey() })).status, 401);
  assert.equal((await request('subscribe', device, { signed: { ...device, token: randomUUID() } })).status, 401);
  assert.equal((await request('subscribe', device, { headers: { origin: 'https://another.test' } })).status, 403);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://fcm.googleapis.com.example.org/x',
    'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8080/x']) {
    assert.equal((await request('subscribe', { ...device, subscription: { ...device.subscription, endpoint } })).status, 400);
  }
  assert.equal((await request('subscribe', device)).status, 204);
  const stored = JSON.stringify([...store.rows.entries()]);
  for (const secret of [device.account, device.token, device.subscription.endpoint, device.subscription.keys.auth]) assert.ok(!stored.includes(secret));
});

test('signed gift wraps fan out once per burst, conceal subscriptions and never forward chat content', async () => {
  const f = fixture(), second = { ...f.device, token: randomUUID(), subscription: subscription() };
  for (const d of [f.device, second]) assert.equal((await f.request('subscribe', d)).status, 204);
  const wrap = f.gift(), now = Date.now();
  assert.equal((await f.request('notify', { ...wrap, sig: '0'.repeat(128) })).status, 400);
  const responses = await Promise.all([1,2,3].map(() => f.request('notify', wrap, { now })));
  assert.ok(responses.every(r => r.status === 202)); await f.drain(); assert.equal(f.sent.length, 2);
  for (const d of [f.device, second]) {
    const delivered = f.sent.find(x => x.sub.endpoint === d.subscription.endpoint);
    assert.deepEqual(delivered.payload, { v: 1, device: createHash('sha256').update(d.token).digest('hex') });
    assert.ok(delivered.options.vapidDetails.privateKey); assert.equal(delivered.options.topic, 'meshell-activity');
  }
  await f.request('notify', f.gift(), { now: now + 1000 }); await f.drain();
  await f.request('notify', wrap, { now: now + 30000 }); await f.drain();
  const absent = await f.request('notify', f.gift(getPublicKey(generateSecretKey()))); await f.drain();
  assert.equal(absent.status, 202); assert.equal(await absent.text(), ''); assert.equal(f.sent.length, 2);
});

test('expiration, rotation, independent devices, and revocation cannot resurrect an old registration', async () => {
  const f = fixture(), now = Date.now();
  const updated = { ...f.device, subscription: subscription() };
  await f.request('subscribe', f.device);
  assert.equal((await f.request('renew', { ...updated, token: randomUUID() })).status, 404);
  assert.equal((await f.request('renew', updated)).status, 204);
  await f.request('notify', f.gift(), { now }); await f.drain();
  assert.equal(f.sent[0].sub.endpoint, updated.subscription.endpoint);
  f.fail(410); await f.request('notify', f.gift(), { now: now + 20000 }); await f.drain();
  await f.request('notify', f.gift(), { now: now + 40000 }); await f.drain(); assert.equal(f.sent.length, 2);
  const next = { ...updated, token: randomUUID() };
  await f.request('subscribe', next);
  assert.equal((await f.request('revoke', next)).status, 204);
  assert.equal((await f.request('renew', next)).status, 404);
  assert.equal((await f.request('subscribe', next)).status, 409);
  await f.request('notify', f.gift(), { now: now + 60000 }); await f.drain(); assert.equal(f.sent.length, 2);
});
