import { test, expect } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools/pure';
import { dm, dot, identity, login, openSettings, relay, reopen } from './relay.mjs';

const inbox = page => page.getByRole('region', { name: 'Conversations' });
const thread = page => page.getByRole('region', { name: 'Messages', exact: true });
const contact = (page, name) => inbox(page).getByRole('button', { name, exact: true });
const recipient = event => event.tags.find(t => t[0] === 'p')?.[1];
const info = (kind, value) => ({ kind, content: JSON.stringify(value) });
const pkOf = event => event.pubkey;

function archiveFixture(account, events, profiles = []) {
  const contacts = new Map();
  for (const event of [...events].sort((a, b) => a.created_at - b.created_at)) {
    const peer = event.pubkey === account.pk ? recipient(event) : event.pubkey;
    contacts.set(peer, { latest_at: event.created_at, latest_event_id: event.id, cnt: 0 });
  }
  const service = {
    requests: [], contacts, cap: Infinity, omitPreviews: false, unavailable: false, unavailablePeer: '',
    extra: [], heldPeer: '', held: [], closed: [],
    connect(ws) {
      ws.onMessage(raw => {
        const [op, id, filter] = JSON.parse(String(raw));
        if (op === 'CLOSE') { service.closed.push(id); return; }
        if (op !== 'REQ' || !Array.isArray(filter?.cache)) throw new Error('Unexpected cache operation');
        const [method, args] = filter.cache;
        service.requests.push({ method, args, id });
        const send = frame => ws.send(JSON.stringify(frame));
        const data = e => send(['EVENT', id, e]);
        if (service.unavailable || args.sender === service.unavailablePeer) {
          send(['NOTICE', id, 'error']); send(['EOSE', id]); return;
        }
        const until = args.until ?? Math.floor(Date.now() / 1000);
        const start = args.offset ?? 0;
        const end = start + Math.min(args.limit, service.cap);
        let page, elements, orderBy;
        if (method === 'get_directmsg_contacts') {
          expect(args.user_pubkey).toBe(account.pk);
          expect(args.relation).toBe('any');
          page = [...contacts].filter(([, row]) => row.latest_at <= until)
            .sort((a, b) => b[1].latest_at - a[1].latest_at || a[0].localeCompare(b[0])).slice(start, end);
          data(info(10_000_118, Object.fromEntries(page)));
          elements = page.map(([peer]) => peer);
          orderBy = 'latest_at';
          if (!service.omitPreviews) {
            for (const [, row] of page) {
              const last = events.find(e => e.id === row.latest_event_id);
              if (last) data(last);
            }
          }
          profiles.filter(e => elements.includes(pkOf(e))).forEach(data);
        } else if (method === 'get_directmsgs') {
          expect(args.receiver).toBe(account.pk);
          const peer = args.sender;
          page = events.filter(e => e.created_at <= until && (
            (e.pubkey === account.pk && recipient(e) === peer) || (e.pubkey === peer && recipient(e) === account.pk)
          )).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)).slice(start, end);
          elements = page.map(e => e.id);
          orderBy = 'created_at';
          if (peer === service.heldPeer) {
            service.held.push({ id, deliver: () => { page.forEach(data); send(['EOSE', id]); } });
            return;
          }
          page.forEach(data);
          profiles.filter(e => e.pubkey === peer).forEach(data);
        } else throw new Error('Unexpected cache method');
        service.extra.forEach(data);
        data(info(10_000_113, { order_by: orderBy, elements }));
        send(['EOSE', id]);
      });
    },
  };
  return service;
}

test('recovers Primal-only incoming and sent chats, names and reloads with four empty relays', async ({ page }) => {
  const me = identity(), alice = identity(), bob = identity();
  const messages = [await dm(alice, me, 100, 'Primal incoming'), await dm(me, alice, 110, 'Primal reply'),
    await dm(me, bob, 120, 'Primal sent-only')];
  const aliceProfile = finalizeEvent({ kind: 0, tags: [], created_at: 18, content: '{"name":"Alice archive"}' }, alice.sk);
  const archive = archiveFixture(me, messages, [aliceProfile]);
  const relays = Object.fromEntries(['a.test','b.test','c.test','d.test'].map(host => [host, relay()]));
  await login(page, me, relays, Object.keys(relays), archive.connect);
  const settings = await openSettings(page);
  await expect(settings.getByRole('checkbox', { name: 'Read history from Primal' })).toBeChecked();
  await settings.getByRole('button', { name: 'Close' }).click();
  for (let i = 0; i < 2; i++) {
    if (i) await reopen(page);
    await contact(page, 'Alice archive').click();
    await expect(thread(page)).toContainText('Primal incoming');
    await expect(thread(page).getByText('Primal reply', { exact: true })).toHaveCount(1);
    await contact(page, bob.npub).click();
    await expect(thread(page)).toContainText('Primal sent-only');
  }
  expect(JSON.stringify(archive.requests)).not.toContain(me.nsec);
  expect(archive.requests.every(r => ['get_directmsg_contacts', 'get_directmsgs'].includes(r.method))).toBe(true);
});

test('uses unsigned contact hints only for discovery and checks signatures and both participants', async ({ page }) => {
  const me = identity(), alice = identity(), foreign = identity(), other = identity();
  const good = await dm(alice, me, 20, 'verified message');
  const wrong = await dm(foreign, other, 30, 'wrong participants');
  const fake = { ...await dm(foreign, me, 100, 'bad signature'), sig: '0'.repeat(128) };
  const archive = archiveFixture(me, [good]);
  archive.omitPreviews = true;
  archive.contacts.set(foreign.pk, { latest_at: 100, latest_event_id: fake.id, cnt: 1 });
  archive.extra = [wrong, fake, { kind: 4, content: 'incomplete' }];
  await login(page, me, {}, [], archive.connect);
  await contact(page, alice.npub).click();
  await expect(thread(page)).toContainText('verified message');
  await expect(contact(page, foreign.npub)).toHaveCount(0);
  await expect(thread(page)).not.toContainText('bad signature');
  await expect(thread(page)).not.toContainText('wrong participants');
  expect(archive.requests.some(r => r.method === 'get_directmsgs' && r.args.sender === alice.pk && r.args.limit === 1)).toBe(true);
});

test('older archive pages preserve same-second ties, earlier contacts and both directions', async ({ page }) => {
  const me = identity(), peer = identity(), b = identity(), c = identity(), old = identity();
  const events = [
    ...await Promise.all(Array.from({ length: 5 }, (_, i) => i % 2 ?
      dm(me, peer, 100, 'tie ' + i) : dm(peer, me, 100, 'tie ' + i))),
    await dm(b, me, 100, 'B'), await dm(c, me, 100, 'C'),
    await dm(old, me, 70, 'older contact'), await dm(peer, me, 1, 'earliest in thread'),
  ];
  const archive = archiveFixture(me, events);
  archive.cap = 2;
  await login(page, me, {}, [], archive.connect);
  await inbox(page).getByRole('button', { name: 'Load older conversations' }).click();
  await expect(contact(page, old.npub)).toBeVisible();
  await contact(page, peer.npub).click();
  for (let i = 0; i < 2; i++) await thread(page).getByRole('button', { name: 'Load older messages' }).click();
  await expect(thread(page).getByText(/^tie \d$/)).toHaveCount(5);
  await expect(thread(page)).toContainText('earliest in thread');
  expect(archive.requests.some(r => r.method === 'get_directmsgs' && r.args.until === 100 && r.args.offset === 4)).toBe(true);
});

test('a missing preview is retryable on mobile while another archived chat stays available', async ({ page }) => {
  const me = identity(), a = identity(), b = identity();
  const archive = archiveFixture(me, [await dm(me, a, 10, 'sent to A'), await dm(b, me, 11, 'received from B')]);
  archive.omitPreviews = true;
  archive.unavailablePeer = a.pk;
  await page.setViewportSize({ width: 390, height: 760 });
  await login(page, me, {}, [], archive.connect);
  await expect(inbox(page)).toContainText('Primal could not finish loading history');
  await contact(page, b.npub).click();
  await expect(thread(page)).toContainText('received from B');
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  archive.unavailablePeer = '';
  await inbox(page).getByRole('button', { name: 'Retry Primal' }).click();
  await contact(page, a.npub).click();
  await expect(thread(page)).toContainText('sent to A');
});

test('cache errors are retryable while relay conversations remain readable and duplicated messages merge', async ({ page }) => {
  const me = identity(), alice = identity(), bob = identity();
  const common = await dm(alice, me, 10, 'on both sources');
  const archive = archiveFixture(me, [common, await dm(bob, me, 20, 'only in archive')]);
  archive.unavailable = true;
  await login(page, me, { 'live.test': relay([common]) }, ['live.test'], archive.connect);
  await expect(inbox(page)).toContainText('Primal could not finish loading history');
  await contact(page, alice.npub).click();
  await expect(thread(page)).toContainText('on both sources');
  await expect(thread(page)).toContainText('Primal could not finish loading history');
  archive.unavailable = false;
  await inbox(page).getByRole('button', { name: 'Retry Primal' }).click();
  await expect(contact(page, bob.npub)).toBeVisible();
  await thread(page).getByRole('button', { name: 'Retry Primal' }).click();
  await expect(thread(page).getByText('on both sources', { exact: true })).toHaveCount(1);
});

test('shows an empty Primal result even when a configured relay rejects the request', async ({ page }) => {
  const me = identity();
  const archive = archiveFixture(me, []);
  const denied = relay();
  denied.rejectReads = true;
  await login(page, me, { 'offline.test': denied }, ['offline.test'], archive.connect);
  await expect(inbox(page)).toContainText('Primal returned no archived conversations for this account');
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://offline.test')).toHaveAccessibleName('Not synced');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(inbox(page).getByRole('button', { name: 'Retry Primal' })).toHaveCount(0);
});

test('cancels an old thread request and lets the user switch off future cache reads', async ({ page }) => {
  const me = identity(), a = identity(), b = identity();
  const archive = archiveFixture(me, [
    await dm(a, me, 11, 'A archive'), await dm(a, me, 10, 'late A'), await dm(b, me, 12, 'B archive'),
  ]);
  archive.heldPeer = a.pk;
  await login(page, me, { 'live.test': relay() }, ['live.test'], archive.connect);
  await contact(page, a.npub).click();
  await expect.poll(() => archive.held.length).toBe(1);
  await contact(page, b.npub).click();
  await expect.poll(() => archive.closed.includes(archive.held[0].id)).toBe(true);
  archive.held[0].deliver();
  await expect(thread(page)).toContainText('B archive');
  await expect(thread(page)).not.toContainText('late A');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Read history from Primal' }).uncheck();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const count = archive.requests.length;
  await reopen(page);
  await expect(inbox(page)).toContainText('No conversations found');
  const settings = await openSettings(page);
  const preference = settings.getByRole('checkbox', { name: 'Read history from Primal' });
  await expect(preference).not.toBeChecked();
  expect(archive.requests).toHaveLength(count);
  await preference.check();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(contact(page, a.npub)).toBeVisible();
  expect(archive.requests.length).toBeGreaterThan(count);
});
