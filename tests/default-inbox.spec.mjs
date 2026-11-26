import { test, expect } from '@playwright/test';
import { verifyEvent } from 'nostr-tools/pure';
import { unwrapEvent } from 'nostr-tools/nip59';
import { dot, identity, inboxList, login, newChat, openSettings, relay, routeRelays } from './relay.mjs';

const defaults = ['relay.damus.io', 'nostr-pub.wellorder.net', 'relay.nostr.band', 'relay.snort.social', 'relay.primal.net'];
const snort = defaults[3], primal = defaults[4];
const tags = hosts => hosts.map(host => ['relay', 'wss://' + host]);
const lists = server => server.writes.filter(e => e.kind === 10050);
const gifts = server => server.writes.filter(e => e.kind === 1059);
const archive = ws => ws.onMessage(raw => {
  const [op, id] = JSON.parse(String(raw));
  if (op === 'REQ') ws.send(JSON.stringify(['EOSE', id]));
});
const message = page => page.getByRole('textbox', { name: 'Message', exact: true });
const inbox = settings => settings.getByRole('region', { name: 'Message inbox' });

test('registers on a phone and sends on the first tap using only synced Snort and Primal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const peer = identity(), recipient = relay();
  const servers = Object.fromEntries(defaults.map(host => [host, relay()]));
  servers['friend.test'] = recipient;
  servers[primal].events.push(inboxList(peer, ['friend.test']));
  servers[defaults[0]].rejectReads = true;
  servers[defaults[1]].rejectWhen = filters => filters.some(f => f.kinds?.includes(1059));
  servers[defaults[2]].rejectWhen = filters => filters.some(f => f.kinds?.includes(4));
  const reads = [], acks = [];
  servers[primal].holdRead = (filters, release) => {
    if (!filters.some(f => f.kinds?.includes(1059) && f.limit > 0)) return false;
    reads.push(release); return true;
  };
  for (const host of [snort, primal]) servers[host].holdConfirmation = (event, confirm) => {
    if (event.kind !== 10050) return false;
    acks.push(confirm); return true;
  };
  await routeRelays(page, servers, archive);
  await page.goto('/');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await newChat(page, peer);
  const text = 'My first private message';
  await message(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing inbox…' })).toBeDisabled();
  expect(lists(servers[snort])).toHaveLength(0);
  await expect.poll(() => reads.length).toBe(1);
  reads[0]();
  await expect.poll(() => acks.length).toBe(2);
  expect(gifts(recipient)).toHaveLength(0);
  await expect(message(page)).toHaveValue(text);
  acks.forEach(confirm => confirm());
  await expect(page.getByText(text, { exact: true })).toHaveCount(1);
  await expect(message(page)).toHaveValue('');
  const [list] = lists(servers[primal]);
  expect(verifyEvent(list)).toBe(true);
  expect(list.tags).toEqual(tags([snort, primal]));
  expect(lists(servers[snort]).map(e => e.id)).toEqual([list.id]);
  expect(defaults.slice(0, 3).flatMap(host => servers[host].writes)).toEqual([]);
  expect(gifts(recipient)).toHaveLength(1);
  const received = unwrapEvent(gifts(recipient)[0], peer.sk);
  expect(received.content).toBe(text); expect(received.pubkey).toBe(list.pubkey);
  expect(gifts(servers[primal])[0].tags).toEqual([['p', list.pubkey]]);
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  const settings = await openSettings(page);
  for (const host of defaults) await expect(dot(settings, 'wss://' + host))
    .toHaveAccessibleName([snort, primal].includes(host) ? 'Synced' : 'Not synced');
  await expect(inbox(settings).getByText('wss://' + primal, { exact: true })).toBeVisible();
  await expect(inbox(settings).getByText('wss://' + snort, { exact: true })).toBeVisible();
});

test('all five healthy defaults are published once and survive a reload', async ({ page }) => {
  const servers = Object.fromEntries(defaults.map(host => [host, relay()]));
  await routeRelays(page, servers, archive);
  await page.goto('/'); await page.getByRole('button', { name: 'Register' }).click();
  await expect.poll(() => defaults.filter(host => lists(servers[host]).length === 1)).toEqual(defaults);
  const [list] = lists(servers[primal]);
  expect(list.tags).toEqual(tags(defaults));
  expect(new Set(defaults.map(host => lists(servers[host])[0].id)).size).toBe(1);
  await page.reload();
  const settings = await openSettings(page);
  for (const host of defaults) await expect(dot(settings, 'wss://' + host)).toHaveAccessibleName('Synced');
  expect(defaults.map(host => lists(servers[host]).length)).toEqual([1, 1, 1, 1, 1]);
});

test('waits for an existing directory list, including an explicitly empty one', async ({ page }) => {
  const me = identity(), source = relay(), other = relay(), held = [];
  source.holdRead = (filters, release) => {
    if (!filters.some(f => f.kinds?.includes(10050))) return false;
    held.push(release); return true;
  };
  source.events = [inboxList(me, [])];
  await login(page, me, { 'a.test': source, 'b.test': other }, undefined, archive);
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://b.test')).toHaveAccessibleName('Synced');
  await expect(inbox(settings).getByRole('status')).toContainText('Checking');
  expect(source.writes).toEqual([]); expect(other.writes).toEqual([]);
  await expect.poll(() => held.length).toBe(1); held[0]();
  await expect(inbox(settings)).toContainText('Your published inbox has no usable relays');
  await expect(inbox(settings).getByRole('button', { name: 'Choose inbox relays' })).toBeVisible();
  expect(source.writes).toEqual([]); expect(other.writes).toEqual([]);
});

test('keeps the draft through offline relays and rejected announcements, then sends on retry', async ({ page }) => {
  const me = identity(), peer = identity(), server = relay([inboxList(peer, ['custom.test'])]);
  server.rejectReads = true;
  await login(page, me, { 'custom.test': server }, undefined, archive);
  const settings = await openSettings(page);
  await expect(inbox(settings)).toContainText('No relay has synced');
  await expect(settings.getByText('wss://' + primal, { exact: true })).toHaveCount(0);
  expect(server.writes).toEqual([]);
  await settings.getByRole('button', { name: 'Close' }).click();
  await newChat(page, peer); await message(page).fill('Retry my first message');
  server.rejectReads = false; server.rejectWrites = true;
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No relay confirmed your inbox list');
  expect(lists(server)).toHaveLength(1); expect(gifts(server)).toHaveLength(0);
  await expect(message(page)).toHaveValue('Retry my first message');
  server.rejectWrites = false;
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(message(page)).toHaveValue('');
  expect(lists(server).at(-1).tags).toEqual(tags(['custom.test']));
  expect(gifts(server)).toHaveLength(2);
});

test('preserves an empty configured relay list and recovers when a relay is added', async ({ page }) => {
  const me = identity(), custom = relay();
  await login(page, me, { 'custom.test': custom }, [], archive);
  const settings = await openSettings(page);
  await expect(inbox(settings)).toContainText('Add a relay');
  await expect(settings.getByRole('listitem')).toHaveCount(0);
  await settings.getByPlaceholder('Enter relay URL').fill('wss://custom.test');
  await settings.getByRole('button', { name: 'Add Relay' }).click();
  await expect(inbox(settings).getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  expect(lists(custom).map(e => e.tags)).toEqual([tags(['custom.test'])]);
});

test('never guesses an existing inbox after the directory refuses a lookup', async ({ page }) => {
  const me = identity(), server = relay();
  server.rejectWhen = filters => filters.some(f => f.kinds?.includes(10050));
  await login(page, me, { 'custom.test': server }, undefined, archive);
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://custom.test')).toHaveAccessibleName('Synced');
  await expect(inbox(settings)).toContainText('check for an existing inbox');
  expect(server.writes).toEqual([]);
  server.rejectWhen = undefined;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(inbox(settings).getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  expect(lists(server).map(e => e.tags)).toEqual([tags(['custom.test'])]);
});

test('a newly generated key can set up a synced relay that restricts directory reads', async ({ page }) => {
  const server = relay();
  server.rejectWhen = filters => filters.some(f => f.kinds?.includes(10050));
  await page.addInitScript(() => localStorage.setItem('relays', JSON.stringify(['wss://members.test'])));
  await routeRelays(page, { 'members.test': server }, archive);
  await page.goto('/'); await page.getByRole('button', { name: 'Register' }).click();
  const settings = await openSettings(page);
  await expect(inbox(settings).getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  expect(lists(server).map(e => e.tags)).toEqual([tags(['members.test'])]);
});

test('two tabs setting up the same account announce a single signed list', async ({ page, context }) => {
  const me = identity(), server = relay(), pending = [];
  server.holdRead = (filters, release) => {
    if (!filters.some(f => f.kinds?.includes(1059) && f.limit > 0)) return false;
    pending.push(release); return true;
  };
  await login(page, me, { 'shared.test': server }, undefined, archive);
  const other = await context.newPage();
  await routeRelays(other, { 'shared.test': server }, archive);
  await other.goto('/chat');
  await expect.poll(() => pending.length).toBe(2);
  pending.forEach(release => release());
  for (const tab of [page, other]) {
    const settings = await openSettings(tab);
    await expect(inbox(settings).getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  }
  expect(lists(server).map(e => e.tags)).toEqual([tags(['shared.test'])]);
});

test('leaving a thread while the first send waits for sync cancels that send', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const me = identity(), peer = identity(), server = relay([inboxList(peer, ['own.test'])]);
  const pending = [];
  server.holdRead = (filters, release) => {
    if (!filters.some(f => f.kinds?.includes(1059) && f.limit > 0)) return false;
    pending.push(release); return true;
  };
  await login(page, me, { 'own.test': server }, undefined, archive);
  await newChat(page, peer);
  await message(page).fill('Cancel this pending send');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing inbox…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect.poll(() => pending.length).toBe(1); pending[0]();
  const settings = await openSettings(page);
  await expect(inbox(settings).getByRole('button', { name: 'Change inbox relays' })).toBeVisible();
  expect(server.writes.map(e => e.kind)).toEqual([10050]);
});

test('a connected relay that never finishes history is excluded after its timeout', async ({ page }) => {
  const good = relay(), silent = relay();
  good.requireAllAuth = true; good.requireWriteAuth = true;
  silent.silent = true;
  await login(page, identity(), { 'members.test': good, 'silent.test': silent }, undefined, archive);
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://members.test')).toHaveAccessibleName('Synced');
  await expect(dot(settings, 'wss://silent.test')).toHaveAccessibleName('Checking');
  expect(good.writes).toEqual([]);
  await expect(inbox(settings).getByRole('button', { name: 'Change inbox relays' })).toBeVisible({ timeout: 18000 });
  await expect(dot(settings, 'wss://silent.test')).toHaveAccessibleName('Not synced');
  expect(lists(good).map(e => e.tags)).toEqual([tags(['members.test'])]);
  expect(silent.writes).toEqual([]);
});
