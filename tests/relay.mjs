import { matchFilters } from 'nostr-tools/filter';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { nip04, nip19 } from 'nostr-tools';

export function identity() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { sk, pk, nsec: nip19.nsecEncode(sk), npub: nip19.npubEncode(pk) };
}

export async function dm(from, to, time, text) {
  return finalizeEvent({
    kind: 4, tags: [['p', to.pk]], created_at: time, content: await nip04.encrypt(from.sk, to.pk, text),
  }, from.sk);
}

export function inboxList(user, urls, time = 100) {
  return finalizeEvent({ kind: 10050, created_at: time, tags: urls.map(url => ['relay', 'wss://' + url]), content: '' }, user.sk);
}

export function relay(events = []) {
  return { events, cap: Infinity, rejectReads: false, rejectWhen: undefined, rejectWrites: false, silent: false, requests: [], writes: [], live: new Set(), sockets: new Set() };
}

export async function openSettings(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return page.getByRole('dialog', { name: 'Settings' });
}

export async function newChat(page, peer) {
  await page.getByRole('button', { name: '+', exact: true }).click();
  await page.getByPlaceholder("Enter recipient's npub").fill(peer.npub);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

export const dot = (dialog, url) => dialog.getByRole('listitem').filter({ has: dialog.page().getByText(url, { exact: true }) }).getByRole('img');

// Every WebSocket is intercepted locally. Fixtures still pass through the
// production signature verification, recipient filters and NIP-04 decryption.
export async function routeRelays(page, servers, primalSocket) {
  await page.routeWebSocket(/.*/, ws => {
    if (ws.url() === 'wss://cache2.primal.net/v1' && primalSocket) return primalSocket(ws);
    const server = servers[new URL(ws.url()).hostname];
    if (!server) throw new Error('Unexpected relay ' + ws.url());
    server.sockets.add(ws);
    const subs = new Map();
    let authenticated;
    const send = frame => ws.send(JSON.stringify(frame));
    ws.onMessage(raw => {
      const [command, arg, ...rest] = JSON.parse(String(raw));
      if (command === 'AUTH') {
        const valid = arg.kind === 22242 && verifyEvent(arg) && arg.tags.some(([t, v]) => t === 'challenge' && v === 'fixture-challenge') &&
          arg.tags.some(([t, v]) => t === 'relay' && new URL(v).hostname === new URL(ws.url()).hostname);
        if (valid) authenticated = arg.pubkey;
        send(['OK', arg.id, valid, valid ? '' : 'invalid: auth']); return;
      }
      if (command === 'CLOSE') {
        server.live.delete(subs.get(arg));
        subs.delete(arg);
        return;
      }
      if (command === 'EVENT') {
        if (server.requireWriteAuth && !authenticated) {
          send(['AUTH', 'fixture-challenge']); send(['OK', arg.id, false, 'auth-required: authenticate']); return;
        }
        server.writes.push(arg);
        if (!server.rejectWrites) {
          server.events.push(arg);
          for (const entry of server.live) {
            if (matchFilters(entry.filters, arg)) entry.deliver(arg);
          }
        }
        const confirm = () => send(['OK', arg.id, !server.rejectWrites, server.rejectWrites ? 'blocked: test' : '']);
        if (!server.holdConfirmation?.(arg, confirm)) confirm();
        return;
      }
      if (command !== 'REQ') return;
      server.requests.push(rest);
      if ((server.requireAllAuth && !authenticated) || server.requireReadAuth && rest.some(f => f.kinds?.includes(1059) && !f['#p']?.includes(authenticated))) {
        send(['AUTH', 'fixture-challenge']); send(['CLOSED', arg, 'auth-required: authenticate']); return;
      }
      if (server.rejectReads || server.rejectWhen?.(rest)) return send(['CLOSED', arg, 'restricted: test']);
      const entry = { filters: rest, deliver: event => send(['EVENT', arg, event]) };
      subs.set(arg, entry);
      server.live.add(entry);
      if (server.silent) return;
      function history() {
        if (!subs.has(arg)) return;
        const sent = new Set();
        for (const f of rest) {
          const matches = server.events.filter(e => matchFilters([f], e))
            .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
            .slice(0, Math.min(f.limit ?? Infinity, server.cap));
          for (const event of matches) {
            if (!sent.has(event.id)) entry.deliver(event);
            sent.add(event.id);
          }
        }
        send(['EOSE', arg]);
      }
      if (!server.holdRead?.(rest, history)) history();
    });
    ws.onClose(() => {
      server.sockets.delete(ws);
      for (const entry of subs.values()) server.live.delete(entry);
    });
  });
}

export async function login(page, user, servers, initial = Object.keys(servers), primalSocket, entryURL = '/') {
  await routeRelays(page, servers, primalSocket);
  await page.addInitScript(hosts => {
    if (!localStorage.getItem('relays')) localStorage.setItem('relays', JSON.stringify(hosts.map(h => 'wss://' + h)));
  }, initial);
  await page.goto(entryURL);
  await page.getByPlaceholder('Enter your nsec').fill(user.nsec);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await setupPin(page);
}

export const testPin = '083574';
export async function typePin(page, pin = testPin) {
  for (const digit of pin) await page.keyboard.press(digit);
}
export async function setupPin(page, pin = testPin) {
  await page.getByRole('heading', { name: 'Create your PIN' }).waitFor();
  await typePin(page, pin);
  await page.getByRole('heading', { name: 'Confirm your PIN' }).waitFor();
  await typePin(page, pin);
  await page.waitForURL('**/chat');
}
export async function unlock(page, pin = testPin) {
  await page.getByRole('heading', { name: 'Unlock MeShell' }).waitFor();
  await typePin(page, pin);
  await page.waitForURL('**/chat');
}
export async function reopen(page) { await page.reload(); await unlock(page); }
