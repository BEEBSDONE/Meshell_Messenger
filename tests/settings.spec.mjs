import { test, expect } from '@playwright/test';
import { dm, dot, identity, login, openSettings, relay } from './relay.mjs';

function emptyArchive(ws) {
  ws.onMessage(raw => {
    const [command, id] = JSON.parse(String(raw));
    if (command === 'REQ') ws.send(JSON.stringify(['EOSE', id]));
  });
}

for (const mobile of [true, false]) {
  test(`${mobile ? 'mobile' : 'desktop'} Settings identifies a relay that rejects just one thread direction and retries it`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 360, height: 780 });
    const me = identity(), peer = identity();
    const healthy = relay([await dm(peer, me, 10, 'delivered by healthy relay')]);
    const partial = relay();
    const incomingHistory = filters => filters.some(f => f.limit > 0 && f.authors?.includes(peer.pk) && f['#p']?.includes(me.pk));
    partial.rejectWhen = incomingHistory;
    await login(page, me, { 'good.test': healthy, 'partial.test': partial }, ['good.test', 'partial.test'], emptyArchive);
    let settings = await openSettings(page);
    await expect(dot(settings, 'wss://partial.test')).toHaveAccessibleName('Synced');
    await settings.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: peer.npub }).click();
    const messages = page.getByRole('region', { name: 'Messages', exact: true });
    await expect(messages).toContainText('delivered by healthy relay');
    await expect.poll(() => partial.requests.some(incomingHistory)).toBe(true);
    await expect(messages.getByText('Loading messages…')).toHaveCount(0);
    await expect(messages).not.toContainText(/relays? could not sync/i);
    await expect(messages.getByRole('button', { name: /^Retry( sync)?$/ })).toHaveCount(0);
    if (mobile) await page.getByRole('button', { name: 'Back to conversations' }).click();
    settings = await openSettings(page);
    await expect(dot(settings, 'wss://good.test')).toHaveAccessibleName('Synced');
    await expect(dot(settings, 'wss://partial.test')).toHaveAccessibleName('Not synced');
    const count = partial.requests.filter(incomingHistory).length;
    await settings.getByRole('button', { name: 'Retry sync' }).click();
    await expect.poll(() => partial.requests.filter(incomingHistory).length).toBeGreaterThan(count);
    await expect(dot(settings, 'wss://partial.test')).toHaveAccessibleName('Not synced');
    partial.rejectWhen = undefined;
    await settings.getByRole('button', { name: 'Retry sync' }).click();
    await expect(dot(settings, 'wss://partial.test')).toHaveAccessibleName('Synced');
    if (mobile) await expect.poll(() => [...partial.live].filter(s => s.filters.some(f => f.authors && f['#p'])).length).toBe(0);
    await expect(settings.getByRole('button', { name: 'Retry sync' })).toHaveCount(0);
  });
}

test('dark phone Settings keeps the black Close label, status dots and long relay URLs inside the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 570 });
  const me = identity();
  const denied = relay();
  denied.rejectReads = true;
  const servers = { 'good.test': relay(), 'down.test': denied, 'long.test': relay(), 'd.test': relay(), 'e.test': relay() };
  await login(page, me, servers, ['good.test', 'down.test', 'd.test', 'e.test'], emptyArchive);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('checkbox', { name: 'Dark mode' }).check();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const long = 'wss://long.test/' + 'x'.repeat(65);
  await dialog.getByPlaceholder('Enter relay URL').fill(long);
  await dialog.getByRole('button', { name: 'Add Relay' }).click();
  const good = dot(dialog, 'wss://good.test'), bad = dot(dialog, 'wss://down.test');
  await expect(good).toHaveAccessibleName('Synced');
  await expect(bad).toHaveAccessibleName('Not synced');
  await expect(good).toHaveCSS('background-color', 'rgb(74, 222, 128)');
  await expect(bad).toHaveCSS('background-color', 'rgb(255, 103, 103)');
  const longRow = dialog.getByRole('listitem').filter({ hasText: long });
  await expect(longRow.getByRole('img')).toHaveAccessibleName('Synced');
  const remove = await longRow.getByRole('button', { name: 'Remove' }).boundingBox();
  const mark = await longRow.getByRole('img').boundingBox();
  expect(mark.x).toBeGreaterThan(remove.x + remove.width);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await longRow.getByRole('button', { name: 'Remove' }).click();
  await expect(longRow).toHaveCount(0);
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toHaveCSS('background-color', 'rgb(209, 213, 219)');
  await expect(close).toHaveCSS('color', 'rgb(0, 0, 0)');
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
});

test('remembers a Primal opt-out across logout and enables history for a different account by default', async ({ page }) => {
  const first = identity(), second = identity(), requests = [];
  await page.addInitScript(pk => {
    if (!localStorage.getItem('primalHistory:' + pk)) localStorage.setItem('primalHistory:' + pk, 'enabled');
  }, first.pk);
  const archive = ws => ws.onMessage(raw => {
    const [cmd, id, filter] = JSON.parse(String(raw));
    if (cmd !== 'REQ') return;
    requests.push(filter.cache[1].user_pubkey);
    ws.send(JSON.stringify(['EOSE', id]));
  });
  await login(page, first, {}, [], archive);
  const signInAgain = async user => {
    await page.getByPlaceholder('Enter your nsec').fill(user.nsec);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL('**/chat');
  };
  const opt = dialog => dialog.getByRole('checkbox', { name: 'Read history from Primal' });
  const logout = async dialog => { await dialog.getByRole('button', { name: 'Logout' }).click(); await page.waitForURL('**/'); };
  await expect.poll(() => requests.includes(first.pk)).toBe(true);
  let dialog = await openSettings(page);
  await expect(opt(dialog)).toBeChecked();
  await opt(dialog).uncheck();
  const count = requests.length;
  await logout(dialog);
  await signInAgain(first);
  dialog = await openSettings(page);
  await expect(opt(dialog)).not.toBeChecked();
  expect(requests).toHaveLength(count);
  await logout(dialog);
  await signInAgain(second);
  await expect.poll(() => requests.includes(second.pk)).toBe(true);
  dialog = await openSettings(page);
  await expect(opt(dialog)).toBeChecked();
});

test('turning Primal off in Settings also stops archive reads in another open tab', async ({ page, context }) => {
  const me = identity();
  await login(page, me, {}, [], emptyArchive);
  const second = await context.newPage();
  const reads = [];
  await second.routeWebSocket(/.*/, ws => {
    if (ws.url() !== 'wss://cache2.primal.net/v1') throw new Error('Unexpected relay');
    ws.onMessage(raw => {
      const [command, id, filter] = JSON.parse(String(raw));
      if (command === 'REQ') { reads.push(filter.cache[0]); ws.send(JSON.stringify(['EOSE', id])); }
    });
  });
  await second.goto('/chat');
  await expect.poll(() => reads.length).toBe(1);
  const firstSettings = await openSettings(page);
  const secondSettings = await openSettings(second);
  const name = 'Read history from Primal';
  await firstSettings.getByRole('checkbox', { name }).uncheck();
  await expect(secondSettings.getByRole('checkbox', { name })).not.toBeChecked();
  await second.reload();
  await (await openSettings(second)).getByRole('checkbox', { name }).waitFor();
  expect(reads).toHaveLength(1);
  await firstSettings.getByRole('checkbox', { name }).check();
  await expect.poll(() => reads.length).toBe(2);
  await second.close();
});
