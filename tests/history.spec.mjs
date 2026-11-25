import { test, expect } from '@playwright/test';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { nip04 } from 'nostr-tools';
import { dm, dot, identity, login as signIn, openSettings, relay } from './relay.mjs';

const contact = (page, who) => page.getByRole('button', { name: who.npub, exact: true });
const thread = page => page.getByRole('region', { name: 'Messages', exact: true });
const inbox = page => page.getByRole('region', { name: 'Conversations' });

// Exercise the ordinary relay reader independently with a saved Primal opt-out.
async function login(page, user, ...args) {
  await page.addInitScript(pk => localStorage.setItem('primalHistory:' + pk, 'disabled'), user.pk);
  await signIn(page, user, ...args);
}

test('incoming and sent-only contacts survive missing or malformed profiles, duplicate relays and reopening', async ({ page }) => {
  const me = identity(), alice = identity(), bob = identity();
  const incoming = await dm(alice, me, 100, 'from Alice');
  const latest = await dm(me, alice, 300, 'latest for Alice');
  const sentOnly = await dm(me, bob, 200, 'only outgoing');
  const malformed = finalizeEvent({ kind: 0, tags: [], created_at: 100, content: '{' }, alice.sk);
  const corrupt = finalizeEvent({ kind: 4, tags: [['p', me.pk]], created_at: 101, content: 'unreadable' }, alice.sk);
  const wrongSignature = { ...await dm(bob, me, 400, 'unverified'), sig: '0'.repeat(128) };
  await login(page, me, {
    'a.test': relay([latest, sentOnly, malformed, corrupt, wrongSignature]), 'b.test': relay([latest, incoming]),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.reload();
    await expect(inbox(page).getByRole('button').first()).toHaveText(alice.npub);
    await contact(page, alice).click();
    await expect(thread(page).getByText('from Alice', { exact: true })).toHaveCount(1);
    await expect(thread(page).getByText('latest for Alice', { exact: true })).toHaveCount(1);
    await expect(thread(page).getByText('This message could not be decrypted.')).toBeVisible();
    await contact(page, bob).click();
    await expect(thread(page).getByText('only outgoing')).toBeVisible();
    await expect(thread(page)).not.toContainText('from Alice');
    await expect(thread(page)).not.toContainText('unverified');
  }
});

test('per-relay, per-direction cursors recover a buried contact and older messages behind a shorter relay cap', async ({ page }) => {
  const me = identity(), recent = identity(), buried = identity();
  const scarce = relay([
    await dm(recent, me, 800, 'inbound 800'), await dm(recent, me, 700, 'inbound 700'),
    await dm(recent, me, 600, 'inbound 600'), await dm(buried, me, 500, 'buried'),
    await dm(me, recent, 10, 'ancient outgoing'),
  ]);
  scarce.cap = 2;
  await login(page, me, { 'a.test': scarce, 'b.test': relay([await dm(recent, me, 1, 'another relay')]) });
  await contact(page, recent).click();
  await expect(thread(page)).toContainText('ancient outgoing');
  await expect(thread(page)).toContainText('another relay');
  await expect(thread(page)).not.toContainText('inbound 600');
  await thread(page).getByRole('button', { name: 'Load older messages' }).click();
  await expect(thread(page)).toContainText('inbound 600');
  for (let i = 0; i < 2; i++) await inbox(page).getByRole('button', { name: 'Load older conversations' }).click();
  await contact(page, buried).click();
  await expect(thread(page)).toContainText('buried');
  expect(scarce.requests.flat().some(f => f.until === 700 && f['#p']?.includes(me.pk))).toBe(true);
});

test('a full page at the same second is expanded without losing messages or looping', async ({ page }) => {
  const me = identity(), peer = identity();
  const sameTime = await Promise.all(Array.from({ length: 55 }, (_, i) => dm(peer, me, 100, 'tie-' + i)));
  const server = relay([...sameTime, await dm(peer, me, 99, 'before ties')]);
  await login(page, me, { 'a.test': server });
  await contact(page, peer).click();
  await expect(thread(page).getByText(/^tie-\d+$/)).toHaveCount(50);
  await thread(page).getByRole('button', { name: 'Load older messages' }).click();
  await expect(thread(page).getByText(/^tie-\d+$/)).toHaveCount(55);
  await expect(thread(page)).toContainText('before ties');
  await thread(page).getByRole('button', { name: 'Load older messages' }).click();
  await expect(thread(page).getByRole('button', { name: 'Load older messages' })).toHaveCount(0);
});

test('rejected history stays retryable; a healthy relay still supplies the inbox', async ({ page }) => {
  const me = identity(), peer = identity();
  const reachable = identity();
  const down = relay([await dm(peer, me, 1, 'restored')]), healthy = relay([await dm(reachable, me, 2, 'available')]);
  down.rejectReads = true;
  await login(page, me, { 'a.test': down, 'b.test': healthy });
  await expect(contact(page, reachable)).toBeVisible();
  await expect(inbox(page)).not.toContainText('No conversations found');
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Not synced');
  await expect(dot(settings, 'wss://b.test')).toHaveAccessibleName('Synced');
  down.rejectReads = false;
  await settings.getByRole('button', { name: 'Retry sync' }).click();
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Synced');
  await settings.getByRole('button', { name: 'Close' }).click();
  await contact(page, peer).click();
  await expect(thread(page)).toContainText('restored');
  await expect(inbox(page)).not.toContainText('could not sync');
});

test('silence times out, and a completed empty query is distinguishable after retry', async ({ page }) => {
  const me = identity(), server = relay();
  server.silent = true;
  await login(page, me, { 'a.test': server });
  await expect(inbox(page)).toContainText('Loading conversations');
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Checking');
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Not synced', { timeout: 15_000 });
  server.silent = false;
  await settings.getByRole('button', { name: 'Retry sync' }).click();
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Synced');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(inbox(page)).toContainText('No conversations found');
});

test('acknowledgement failure keeps the draft; retry signs once and a relay echo appears once', async ({ page }) => {
  const me = identity(), peer = identity();
  const a = relay([await dm(peer, me, 1, 'hello')]), b = relay();
  a.rejectWrites = b.rejectWrites = true;
  await login(page, me, { 'a.test': a, 'b.test': b });
  await contact(page, peer).click();
  const text = 'Keep <literal> markup & text';
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No relay confirmed');
  await expect(input).toHaveValue(text);
  b.rejectWrites = false;
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(thread(page).getByText(text, { exact: true })).toHaveCount(1);
  await expect(input).toHaveValue('');
  expect(b.writes).toHaveLength(2);
  expect(b.writes[0].id).toBe(b.writes[1].id);
  expect(verifyEvent(b.writes[1])).toBe(true);
  expect(await nip04.decrypt(peer.sk, me.pk, b.writes[1].content)).toBe(text);
});

test('changing relays immediately recovers a mobile inbox and leaving the thread closes peer subscriptions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const me = identity(), peer = identity();
  const secondary = relay([await dm(peer, me, 1, 'from added relay')]);
  await login(page, me, { 'a.test': relay(), 'b.test': secondary }, ['a.test']);
  await expect(inbox(page)).toContainText('No conversations found');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByPlaceholder('Enter relay URL').fill('wss://b.test');
  await page.getByRole('button', { name: 'Add Relay' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await contact(page, peer).click();
  await expect(thread(page)).toContainText('from added relay');
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(contact(page, peer)).toBeVisible();
  await expect.poll(() => [...secondary.live].filter(s => s.filters.some(f => f.authors && f['#p'])).length).toBe(0);
});

test('reconnecting refetches the head and keeps messages received before disconnection', async ({ page }) => {
  const me = identity(), peer = identity();
  const server = relay([await dm(peer, me, 10, 'before disconnect')]);
  await login(page, me, { 'a.test': server });
  await contact(page, peer).click();
  await expect(thread(page)).toContainText('before disconnect');
  for (const socket of server.sockets) socket.close({ code: 1001 });
  const settings = await openSettings(page);
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Not synced');
  server.events.push(await dm(peer, me, 11, 'during disconnect'));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dot(settings, 'wss://a.test')).toHaveAccessibleName('Synced');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(thread(page)).toContainText('during disconnect');
  await expect(thread(page).getByText('before disconnect', { exact: true })).toHaveCount(1);
});

test('a new conversation opens immediately without a profile and remains selected when other history arrives', async ({ page }) => {
  const me = identity(), alice = identity(), bob = identity();
  const server = relay();
  await login(page, me, { 'a.test': server });
  await expect(inbox(page)).toContainText('No conversations found');
  await page.getByRole('button', { name: '+' }).click();
  await page.getByPlaceholder("Enter recipient's npub").fill(alice.npub);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  const other = await dm(bob, me, 15, 'other conversation');
  server.events.push(other);
  for (const sub of server.live) sub.deliver(other);
  await expect(contact(page, alice)).toBeVisible();
  await expect(contact(page, bob)).toBeVisible();
  await expect(thread(page)).not.toContainText('other conversation');
});
