import { test, expect } from '@playwright/test';
import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { identity, inboxList, login, openSettings, relay } from './relay.mjs';

test.use({ hasTouch: true });
const archive = ws => ws.onMessage(raw => {
  const [command, id] = JSON.parse(String(raw));
  if (command === 'REQ') ws.send(JSON.stringify(['EOSE', id]));
});

function pillStyle(element) {
  const css = getComputedStyle(element);
  return {
    height: element.getBoundingClientRect().height,
    font: [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight],
    padding: css.padding, radius: css.borderRadius, border: css.borderTopWidth,
    text: css.color, background: css.backgroundColor,
  };
}

test('checked and empty Settings checkboxes keep the same colors when switching themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, identity(), {}, [], archive);
  const names = ['Read history from Primal', 'Save encrypted messages for offline use'];
  async function sampleCheckboxes() {
    const settings = await openSettings(page);
    const colors = [];
    for (const name of names) {
      const checkbox = settings.getByRole('checkbox', { name, exact: true });
      await checkbox.scrollIntoViewIfNeeded();
      const { x, y, width, height } = await checkbox.boundingBox();
      // The center includes the fill and tick, without the surrounding Settings card.
      colors.push(await page.screenshot({ clip: {
        x: Math.floor(x + width / 2) - 5, y: Math.floor(y + height / 2) - 5, width: 10, height: 10,
      } }));
    }
    await settings.getByRole('button', { name: 'Close', exact: true }).tap();
    return colors;
  }
  const light = await sampleCheckboxes();
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('checkbox', { name: 'Dark mode' }).check();
  await page.getByRole('img', { name: 'Meshell Logo' }).tap();
  const dark = await sampleCheckboxes();
  expect(light[0].equals(light[1])).toBe(false);
  for (const [i, name] of names.entries()) expect(light[i].equals(dark[i]), name).toBe(true);
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

    // Record transient focus too. A brief focus on Username can open a phone keyboard.
    await page.evaluate(() => {
      window.profileControlFocus = [];
      document.addEventListener('focusin', event => {
        if (event.target.matches('dialog[aria-label="Profile"] :is(input, button)')) {
          window.profileControlFocus.push(event.target.tagName);
        }
      });
    });
    await menu.tap(); await profile.tap();
    const dialog = page.getByRole('dialog', { name: 'Profile' });
    const nickname = dialog.getByLabel('Username');
    await expect(dialog).toBeFocused();
    expect(await page.evaluate(() => window.profileControlFocus)).toEqual([]);
    await nickname.tap();
    await expect(nickname).toBeFocused();
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

    await menu.press('Enter'); await profile.press('Enter');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nickname).toBeFocused();
    await expect(nickname).toHaveValue('');
    // An immediate reopen must not wait for the browser's queued close event.
    const previousStillMounted = await dialog.getByRole('button', { name: 'Cancel' }).evaluate(async button => {
      const previous = button.closest('dialog');
      button.click();
      await Promise.resolve();
      return previous.isConnected;
    });
    expect(previousStillMounted).toBe(false);
    await menu.press('Enter'); await profile.press('Enter');
    await expect(dialog).toBeFocused();
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
    const footer = page.getByRole('region', { name: 'Conversations' }).getByRole('button', { name: 'Load older conversations' });
    await expect(footer).toBeVisible();
    const footerStyle = await footer.evaluate(pillStyle);
    await page.getByRole('button', { name: peer.npub, exact: true }).tap();
    const thread = page.getByRole('region', { name: 'Messages', exact: true });
    const date = await page.evaluate(seconds => new Date(seconds * 1000).toLocaleDateString(undefined,
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), timestamp);
    const datePill = thread.getByText(date, { exact: true });
    const reference = await datePill.evaluate(pillStyle);
    expect(reference.padding).toBe('5px 10px');
    expect(footerStyle).toEqual(reference);
    const older = thread.getByRole('button', { name: 'Load older messages' });
    const legacy = thread.getByRole('button', { name: 'Look for legacy messages' });
    for (const action of [older, legacy]) {
      expect(await action.evaluate(pillStyle)).toEqual(reference);
      const box = await action.boundingBox();
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
    const relayCheckbox = inbox.getByRole('checkbox', { name: 'wss://sample.test' });
    await expect(relayCheckbox).toBeChecked();
    await expect(relayCheckbox).toHaveCSS('accent-color', 'rgb(255, 184, 66)');
    await expect(relayCheckbox).toHaveCSS('color-scheme', 'dark');
    await inbox.getByRole('button', { name: 'Cancel' }).tap();
    const prefs = settings.getByRole('region', { name: 'Device preferences' });
    const boxes = prefs.getByRole('checkbox');
    await expect(boxes).toHaveCount(3);
    const positions = [];
    for (const checkbox of await boxes.all()) {
      await expect(checkbox).toHaveAccessibleDescription(/\S+/);
      await expect(checkbox).toHaveCSS('accent-color', 'rgb(255, 184, 66)');
      await expect(checkbox).toHaveCSS('color-scheme', 'dark');
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
