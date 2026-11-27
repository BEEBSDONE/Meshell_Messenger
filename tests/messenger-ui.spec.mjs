import { test, expect } from '@playwright/test';
import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { identity, inboxList, login, openSettings, relay } from './relay.mjs';

test.use({ hasTouch: true });
const archive = ws => ws.onMessage(raw => {
  const [command, id] = JSON.parse(String(raw));
  if (command === 'REQ') ws.send(JSON.stringify(['EOSE', id]));
});

for (const width of [360, 1024]) {
  test(`outside taps dismiss the menu and Profile at ${width}px while inside controls work`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await login(page, identity(), {}, [], archive);
    const menu = page.getByRole('button', { name: 'Menu' });
    const profile = page.getByRole('button', { name: 'Profile', exact: true });
    await menu.tap();
    await page.getByRole('checkbox', { name: 'Dark mode' }).tap();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('img', { name: 'Meshell Logo' }).tap();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    await menu.tap();
    await page.getByRole('button', { name: '+', exact: true }).tap();
    await expect(page.getByPlaceholder("Enter recipient's npub")).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Cancel' }).tap();

    await menu.tap(); await profile.tap();
    const dialog = page.getByRole('dialog', { name: 'Profile' });
    const nickname = dialog.getByLabel('Username');
    await nickname.fill('Unsaved edit');
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(12);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 5);
    await expect(nickname).toHaveValue('Unsaved edit');
    await page.mouse.move(box.x + box.width / 2, box.y + 5);
    await page.mouse.down(); await page.mouse.move(3, box.y + 5); await page.mouse.up();
    await expect(dialog).toBeVisible();
    await page.touchscreen.tap(3, box.y + box.height / 2);
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();

    await menu.tap(); await profile.tap();
    await expect(nickname).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await menu.tap(); await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
  });
}

for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'} phone history pills and Settings preferences share the theme and stay aligned`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const me = identity(), peer = identity();
    const timestamp = 1795694400;
    const rumor = createRumor({ kind: 14, content: 'Example private message', created_at: timestamp, tags: [['p', me.pk]] }, peer.sk);
    const wrap = createWrap(createSeal(rumor, peer.sk, me.pk), me.pk);
    const server = relay([wrap, inboxList(me, ['sample.test'])]);
    await login(page, me, { 'sample.test': server }, ['sample.test'], archive);
    if (dark) {
      await page.getByRole('button', { name: 'Menu' }).tap();
      await page.getByRole('checkbox', { name: 'Dark mode' }).check();
      await page.getByRole('img', { name: 'Meshell Logo' }).tap();
    }
    await page.getByRole('button', { name: peer.npub, exact: true }).tap();
    const thread = page.getByRole('region', { name: 'Messages', exact: true });
    const date = await page.evaluate(seconds => new Date(seconds * 1000).toLocaleDateString(undefined,
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), timestamp);
    const datePill = thread.getByText(date, { exact: true });
    const surface = await datePill.evaluate(el => getComputedStyle(el).backgroundColor);
    const older = thread.getByRole('button', { name: 'Load older messages' });
    const legacy = thread.getByRole('button', { name: 'Look for legacy messages' });
    for (const action of [older, legacy]) {
      await expect(action).toHaveCSS('background-color', surface);
      const box = await action.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThan(2);
      expect(await action.evaluate(el => parseFloat(getComputedStyle(el).borderRadius))).toBeGreaterThanOrEqual(box.height / 2);
    }
    await legacy.tap(); await expect(legacy).toHaveCount(0);
    await older.tap();
    await expect(thread.getByText('Example private message')).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversations' }).tap();
    const settings = await openSettings(page);
    const inbox = settings.getByRole('region', { name: 'Message inbox' });
    await expect(inbox.getByRole('list', { name: 'Published inbox relays' })).toContainText('wss://sample.test');
    await inbox.getByRole('button', { name: 'Change inbox relays' }).tap();
    await expect(inbox.getByRole('checkbox', { name: 'wss://sample.test' })).toBeChecked();
    await inbox.getByRole('button', { name: 'Cancel' }).tap();
    const prefs = settings.getByRole('region', { name: 'Device preferences' });
    const boxes = prefs.getByRole('checkbox');
    await expect(boxes).toHaveCount(3);
    const positions = [];
    for (const checkbox of await boxes.all()) {
      await expect(checkbox).toHaveAccessibleDescription(/\S+/);
      positions.push((await checkbox.boundingBox()).x);
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
    await expect(settings).toHaveCSS('color-scheme', dark ? 'dark' : 'light');
    expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const primal = prefs.getByRole('checkbox', { name: 'Read history from Primal' });
    await prefs.getByText('Read history from Primal', { exact: true }).tap();
    await expect(primal).not.toBeChecked();
    await settings.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(settings).toHaveCount(0);
  });
}
