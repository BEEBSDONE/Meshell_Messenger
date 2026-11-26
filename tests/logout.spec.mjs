import { test, expect } from '@playwright/test';
import { identity, login, openSettings, setupPin, unlock } from './relay.mjs';

test('logout can be dismissed, clipboard failure is recoverable, and the copied key signs back in', async ({ page }) => {
  const me = identity();
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { if (!window.allowCopy) throw Error('Denied'); window.testClipboard = text; },
  } }));
  await login(page, me, {}, [], ws => ws.onMessage(raw => {
    const [cmd, id] = JSON.parse(String(raw));
    if (cmd === 'REQ') ws.send(JSON.stringify(['EOSE', id]));
  }));
  const settings = await openSettings(page);
  const trigger = settings.getByRole('button', { name: 'Logout' });
  const dialog = page.getByRole('dialog', { name: 'Log out of MeShell?' });
  await trigger.click();
  await expect(dialog.getByRole('button')).toHaveCount(2);
  const copy = dialog.getByRole('button', { name: 'Copy nsec' });
  await expect(copy).toBeFocused();
  await expect(dialog).toContainText('private key to sign in again');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await trigger.click();
  await copy.click();
  await expect(dialog.getByRole('status')).toContainText('Copy failed');
  await page.evaluate(() => { window.allowCopy = true; });
  await copy.click();
  await expect(dialog.getByRole('status')).toContainText('nsec copied');
  const saved = await page.evaluate(() => window.testClipboard);
  expect(saved === me.nsec).toBe(true);
  expect((await page.locator('body').innerText()).includes(saved)).toBe(false);
  const confirm = dialog.getByRole('button', { name: 'Logout' });
  await expect(confirm).toHaveCSS('background-color', 'rgb(185, 28, 28)');
  await confirm.click();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await page.getByPlaceholder('Enter your nsec').fill(saved);
  await page.getByRole('button', {name:'Login',exact:true}).click();
  await setupPin(page);
  await expect(page).toHaveURL(/\/chat$/);
});

test('confirming logout also removes access in an already-open chat tab', async ({ page, context }) => {
  const me = identity();
  const empty = ws => ws.onMessage(raw => {
    const [op, id] = JSON.parse(String(raw));
    if (op === 'REQ') ws.send(JSON.stringify(['EOSE', id]));
  });
  await login(page, me, {}, [], empty);
  const second = await context.newPage();
  await second.routeWebSocket(/.*/, empty);
  await second.goto('/chat');
  await unlock(second);
  await expect(second.getByRole('button', { name: 'Menu' })).toBeVisible();
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Logout' }).click();
  await expect(second.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Log out of MeShell?' }).getByRole('button', { name: 'Logout' }).click();
  await expect(second.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  await second.goto('/chat');
  await expect(second).toHaveURL(/\/$/);
  await second.close();
});
