import { matchFilters } from 'nostr-tools/filter';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
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

export function relay(events = []) {
  return { events, cap: Infinity, rejectReads: false, rejectWrites: false, silent: false, requests: [], writes: [], live: new Set(), sockets: new Set() };
}

// Every WebSocket is intercepted locally. Fixtures still pass through the
// production signature verification, recipient filters and NIP-04 decryption.
export async function login(page, user, servers, initial = Object.keys(servers), primalSocket) {
  await page.routeWebSocket(/.*/, ws => {
    if (ws.url() === 'wss://cache2.primal.net/v1' && primalSocket) return primalSocket(ws);
    const server = servers[new URL(ws.url()).hostname];
    if (!server) throw new Error('Unexpected relay ' + ws.url());
    server.sockets.add(ws);
    const subs = new Map();
    const send = frame => ws.send(JSON.stringify(frame));
    ws.onMessage(raw => {
      const [command, arg, ...rest] = JSON.parse(String(raw));
      if (command === 'CLOSE') {
        server.live.delete(subs.get(arg));
        subs.delete(arg);
        return;
      }
      if (command === 'EVENT') {
        server.writes.push(arg);
        if (!server.rejectWrites) {
          server.events.push(arg);
          for (const entry of server.live) {
            if (matchFilters(entry.filters, arg)) entry.deliver(arg);
          }
        }
        send(['OK', arg.id, !server.rejectWrites, server.rejectWrites ? 'blocked: test' : '']);
        return;
      }
      if (command !== 'REQ') return;
      server.requests.push(rest);
      if (server.rejectReads) return send(['CLOSED', arg, 'restricted: test']);
      const entry = { filters: rest, deliver: event => send(['EVENT', arg, event]) };
      subs.set(arg, entry);
      server.live.add(entry);
      if (server.silent) return;
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
    });
    ws.onClose(() => {
      server.sockets.delete(ws);
      for (const entry of subs.values()) server.live.delete(entry);
    });
  });
  await page.addInitScript(hosts => {
    if (!localStorage.getItem('relays')) localStorage.setItem('relays', JSON.stringify(hosts.map(h => 'wss://' + h)));
  }, initial);
  await page.goto('/');
  await page.getByPlaceholder('Enter your nsec').fill(user.nsec);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/chat');
}
