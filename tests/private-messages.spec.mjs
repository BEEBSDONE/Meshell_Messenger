import { test, expect } from '@playwright/test';
import { createRumor, createSeal, createWrap, unwrapEvent } from 'nostr-tools/nip59';
import { verifyEvent } from 'nostr-tools/pure';
import { dm, identity, inboxList, login, newChat, openSettings, relay } from './relay.mjs';

const chat = (page, peer) => page.getByRole('button', { name: peer.npub, exact: true });
const input = page => page.getByRole('textbox', { name: 'Message', exact: true });
const submit = page => page.getByRole('button', { name: 'Send', exact: true });
const archive = (calls = []) => ws => ws.onMessage(raw => {
  const [op, id, filter] = JSON.parse(String(raw));
  if (op === 'REQ') { calls.push(filter.cache); ws.send(JSON.stringify(['EOSE', id])); }
});
function wrap(from, to, rumor) { return createWrap(createSeal(rumor, from.sk, to.pk), to.pk); }
const rumor = (from, to, text, time = 123) => createRumor({ kind: 14, content: text, tags: [['p', to.pk]], created_at: time }, from.sk);
async function send(page, text) { await input(page).fill(text); await submit(page).click(); }

test('two accounts exchange NIP-17 through separate authenticated inbox relays and see the same timeline after reload', async ({ page, browser }) => {
  const alice = identity(), bob = identity();
  const directory = relay([inboxList(alice, ['alice.test']), inboxList(bob, ['bob.test'], 2), inboxList(bob, ['stale.test'], 1)]);
  const a = relay(), b = relay(), stale = relay();
  a.requireReadAuth = b.requireReadAuth = a.requireWriteAuth = b.requireWriteAuth = true;
  const servers = { 'directory.test': directory, 'alice.test': a, 'bob.test': b, 'stale.test': stale };
  const calls = [];
  const context = await browser.newContext({ baseURL: new URL(test.info().project.use.baseURL).origin, serviceWorkers: 'block' });
  try {
    const other = await context.newPage();
    await login(page, alice, servers, ['directory.test'], archive(calls));
    await login(other, bob, servers, ['directory.test'], archive(calls));
    await newChat(page, bob);
    await send(page, 'Hello from Alice 👋');
    await chat(other, alice).click();
    await expect(other.getByText('Hello from Alice 👋', { exact: true })).toBeVisible();
    await send(other, 'Reply from Bob');
    await expect(page.getByText('Reply from Bob', { exact: true })).toBeVisible();
    for (const [p, peer] of [[page, bob], [other, alice]]) {
      await p.reload(); await chat(p, peer).click();
      await expect(p.getByText('Reply from Bob', { exact: true })).toHaveCount(1);
      await expect(p.getByText('Hello from Alice 👋', { exact: true })).toHaveCount(1);
    }
    expect(directory.writes).toHaveLength(0); expect(stale.sockets.size).toBe(0);
    expect(a.writes).toHaveLength(2); expect(b.writes).toHaveLength(2);
    for (const [server, recipient] of [[a, alice], [b, bob]]) for (const event of server.writes) {
      expect(verifyEvent(event)).toBe(true); expect(event.kind).toBe(1059);
      expect(event.tags).toEqual([['p', recipient.pk]]);
      expect([alice.pk, bob.pk]).not.toContain(event.pubkey);
    }
    expect(new Set([...a.writes, ...b.writes].map(e => e.pubkey)).size).toBe(4);
    const first = unwrapEvent(b.writes[0], bob.sk);
    expect(first).toEqual(unwrapEvent(a.writes[0], alice.sk)); expect(first.pubkey).toBe(alice.pk);
    expect(calls.every(([method]) => method === 'get_directmsg_contacts')).toBe(true);
  } finally { await context.close(); }
});

test('an account chooses its public inbox and an unpublished contact keeps the new message as a draft', async ({ page }) => {
  const me = identity(), peer = identity();
  const a = relay(), b = relay();
  await login(page, me, { 'one.test': a, 'two.test': b }, ['one.test','two.test'], archive());
  const settings = await openSettings(page);
  const section = settings.getByRole('region', { name: 'Message inbox' });
  await section.getByRole('button', { name: 'Change inbox relays' }).click();
  await section.getByRole('checkbox', { name: 'wss://two.test' }).uncheck();
  await section.getByRole('button', { name: 'Publish inbox relays' }).click();
  await expect(section.getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  expect(a.writes.map(e => e.tags)).toEqual([[['relay','wss://one.test'],['relay','wss://two.test']], [['relay','wss://one.test']]]);
  expect(a.writes.every(e => e.kind === 10050 && verifyEvent(e))).toBe(true);
  await settings.getByRole('button', { name: 'Close' }).click();
  await newChat(page, peer); await send(page, 'Do not downgrade');
  await expect(page.getByRole('alert')).toContainText('No NIP-17 inbox');
  await expect(input(page)).toHaveValue('Do not downgrade');
  expect([...a.writes,...b.writes].every(e => e.kind === 10050)).toBe(true);
  await page.reload();
  const reopened = await openSettings(page);
  await expect(reopened.getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  await expect(reopened.getByRole('region', { name: 'Message inbox' }).getByText('wss://two.test')).toHaveCount(0);
  expect(a.writes).toHaveLength(2);
});

test('a delivered message survives a failed sender copy and reload without republishing to the recipient', async ({ page }) => {
  const me = identity(), peer = identity(), a = relay(), b = relay();
  const dir = relay([inboxList(me, ['own.test']), inboxList(peer, ['peer.test'])]);
  a.rejectWrites = true;
  await login(page, me, { 'dir.test': dir, 'own.test': a, 'peer.test': b }, ['dir.test'], archive());
  await newChat(page, peer); await send(page, 'Save my sent copy');
  await expect(page.getByRole('alert')).toContainText('relay accepted the message');
  expect(b.writes).toHaveLength(1);
  await page.reload(); await chat(page, peer).click();
  await expect(input(page)).toHaveValue('Save my sent copy');
  a.rejectWrites = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(input(page)).toHaveValue('');
  await expect(page.getByText('Save my sent copy', { exact: true })).toHaveCount(1);
  expect(b.writes).toHaveLength(1); expect(a.writes).toHaveLength(2); expect(a.writes[0].id).toBe(a.writes[1].id);
  expect(unwrapEvent(a.writes[1], me.sk)).toEqual(unwrapEvent(b.writes[0], peer.sk));
});

test('validates seals, author, room membership and rumor ID, deduplicates rewraps, and reads old gift pages', async ({ page }) => {
  const me = identity(), peer = identity(), unrelated = identity();
  const one = rumor(peer, me, 'Authentic private text');
  const badGroup = createRumor({ ...one, tags: [['p',me.pk],['p',unrelated.pk]], content:'Group text' }, peer.sk);
  const impostor = createRumor({ ...one, content:'Wrong signer' }, unrelated.sk);
  const data = [
    wrap(peer, me, one), wrap(peer, me, one), wrap(peer, me, badGroup), wrap(peer, me, impostor),
    wrap(peer, me, { ...one, content:'Wrong hash' }), wrap(peer, me, rumor(peer, unrelated, 'Wrong party')),
    createWrap({ ...createSeal(one, peer.sk, me.pk), sig: '0'.repeat(128) }, me.pk),
  ];
  const good = relay(data);
  await login(page, me, { 'test.test': relay([inboxList(me, ['gift.test']), await dm(peer,me,1,'Legacy text')]), 'gift.test': good }, ['test.test'], archive());
  await chat(page, peer).click();
  await expect(page.getByText('Legacy text', { exact: true })).toBeVisible();
  await expect(page.getByText('Authentic private text', { exact: true })).toHaveCount(1);
  for (const text of ['Group text', 'Wrong signer', 'Wrong hash', 'Wrong party']) await expect(page.getByText(text,{exact:true})).toHaveCount(0);
  await expect(chat(page, unrelated)).toHaveCount(0);
  // A relay page is sorted by outer timestamps. The rendered chat uses the inner timestamp.
  const older = wrap(peer, me, rumor(peer, me, 'Older private text', 2));
  const newest = wrap(peer, me, rumor(peer, me, 'Newest private text', 200));
  const more = [older, newest, ...data].sort((a,b)=> b.created_at-a.created_at);
  good.events = more; good.cap = 2;
  await page.reload(); await chat(page, peer).click();
  for (let step=0; step<8 && !(await page.getByText('Older private text',{exact:true}).count() && await page.getByText('Newest private text',{exact:true}).count()); step++) {
    await page.getByRole('region',{name:'Messages',exact:true}).getByRole('button',{name:'Load older messages'}).click();
    await expect(page.getByText('Loading messages…',{exact:true})).toHaveCount(0);
  }
  const words = await page.getByRole('region',{name:'Messages',exact:true}).innerText();
  expect(words).toContain('Older private text'); expect(words.indexOf('Older private text')).toBeLessThan(words.indexOf('Newest private text'));
});

test('self messages need a single wrap and repeated identical text remains two distinct messages', async ({ page }) => {
  const me = identity(), a = relay([inboxList(me, ['own.test'])]);
  await login(page, me, { 'own.test': a }, ['own.test'], archive());
  await newChat(page, me);
  await send(page, 'A note to myself'); await expect(input(page)).toHaveValue('');
  await send(page, 'A note to myself'); await expect(input(page)).toHaveValue('');
  await expect(page.getByText('A note to myself',{exact:true})).toHaveCount(2);
  expect(a.writes).toHaveLength(2);
  expect(new Set(a.writes.map(e => unwrapEvent(e,me.sk).id)).size).toBe(2);
});

test('inbox discovery and legacy history also work on a relay that requires NIP-42 for every read', async ({ page }) => {
  const me = identity(), peer = identity();
  const privateRelay = relay([inboxList(me, ['members.test']), inboxList(peer, ['members.test']), await dm(peer, me, 10, 'Members-only history')]);
  privateRelay.requireAllAuth = true;
  await login(page, me, { 'members.test': privateRelay }, ['members.test'], archive());
  await chat(page, peer).click();
  await expect(page.getByText('Members-only history',{exact:true})).toBeVisible();
  await send(page, 'Encrypted on the private relay');
  await expect(page.getByText('Encrypted on the private relay',{exact:true})).toHaveCount(1);
  expect(privateRelay.writes.map(event => event.kind)).toEqual([1059,1059]);
  await expect.poll(() => [...privateRelay.live].filter(s => s.filters.some(f => f.kinds?.includes(10050) && f.authors?.includes(peer.pk))).length).toBe(0);
});
