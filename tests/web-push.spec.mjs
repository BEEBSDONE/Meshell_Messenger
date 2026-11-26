import { test, expect } from '@playwright/test';
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { validateEvent as validateAuth, unpackEventFromToken } from 'nostr-tools/nip98';
import { servePwa } from './pwa-origin.mjs';
import { identity, inboxList, login, newChat, openSettings, relay, reopen, unlock } from './relay.mjs';

const archive = ws => ws.onMessage(raw => { const [op,id] = JSON.parse(String(raw)); if (op === 'REQ') ws.send(JSON.stringify(['EOSE',id])); });
const choice = page => page.getByRole('checkbox', { name: 'Enable notifications on this device' });
const serverKey = () => createECDH('prime256v1').generateKeys().toString('base64url');

async function deviceFixture(page, options = {}) {
  const registrations = [], revocations = [], key = serverKey();
  const subscription = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-device',
    keys: { auth: randomBytes(16).toString('base64url'), p256dh: serverKey() } };
  await page.addInitScript(({ subscription, denied }) => {
    window.fixtureSubscriptions = 0;
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: {
      permission: localStorage.getItem('qa-permission') || (denied ? 'denied' : 'granted'),
    } });
    const current = { ...subscription, endpoint: localStorage.getItem('qa-endpoint') || subscription.endpoint };
    const sub = { ...current, toJSON: () => current, unsubscribe: async () => { localStorage.removeItem('qa-push-grant'); return true; } };
    const reg = { active: {}, pushManager: {
      getSubscription: async () => localStorage.getItem('qa-push-grant') ? sub : null,
      subscribe: async () => { window.fixtureSubscriptions++; localStorage.setItem('qa-push-grant','yes'); return sub; },
    }, getNotifications: async () => [] };
    const sw = navigator.serviceWorker ?? {};
    Object.defineProperty(sw, 'getRegistration', { configurable: true, value: async () => reg });
    if (!navigator.serviceWorker) Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
  }, { subscription, denied: options.denied });
  await page.route('**/api/push/**', async route => {
    const req = route.request();
    const action = new URL(req.url()).pathname.split('/').pop();
    if (action === 'key') return route.fulfill({ json: { publicKey: key } });
    if (action === 'subscribe') {
      const data = req.postDataJSON();
      const event = await unpackEventFromToken(req.headers().authorization);
      expect(await validateAuth(event, req.url(), 'POST', data)).toBe(true);
      expect(event.pubkey).toBe(data.account);
      registrations.push(data);
      if (options.expired?.(data)) return route.fulfill({ status: 410, body: '' });
      return route.fulfill({ status: 204, body: '' });
    }
    if (action === 'revoke') { revocations.push(req.postDataJSON()); return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ status: 202, body: '' });
  });
  return { registrations, revocations };
}
test('push is opt-in per device, survives locking and is revoked on opt-out or logout', async ({ page }) => {
  const { registrations, revocations } = await deviceFixture(page);
  const me = identity(); await login(page, me, {}, [], archive);
  let settings = await openSettings(page);
  await expect(choice(settings)).toBeEnabled(); await expect(choice(settings)).not.toBeChecked();
  expect(await page.evaluate(() => window.fixtureSubscriptions)).toBe(0);
  await choice(settings).check();
  await expect.poll(() => registrations.length).toBe(1);
  await settings.getByRole('button', { name:'Lock now' }).click();
  await unlock(page);
  settings = await openSettings(page); await expect(choice(settings)).toBeChecked();
  await choice(settings).uncheck();
  await expect.poll(() => revocations.length).toBe(1);
  expect(revocations[0].token).toBe(registrations[0].token);
  await choice(settings).check(); await expect.poll(() => registrations.length).toBe(2);
  expect(registrations[1].token).not.toBe(registrations[0].token);
  await settings.getByRole('button', { name: 'Logout' }).click();
  await page.getByRole('dialog', { name: 'Log out of MeShell?' }).getByRole('button', { name:'Logout' }).click();
  await page.getByRole('button', { name:'Register' }).waitFor();
  await expect.poll(() => revocations.some(r => r.token === registrations[1].token)).toBe(true);
});
test('denied permission keeps the device off and makes no subscription', async ({ page }) => {
  const f = await deviceFixture(page, { denied: true }); await login(page, identity(), {}, [], archive);
  const settings = await openSettings(page);
  await expect(choice(settings)).toBeDisabled(); await expect(settings.getByText('Notifications are blocked in your browser settings.')).toBeVisible();
  expect(f.registrations).toHaveLength(0);
});
test('an expired subscription repairs on unlock and resetting browser permission retires the device', async ({ page }) => {
  let expiredToken;
  const { registrations, revocations } = await deviceFixture(page, { expired: data => data.token === expiredToken });
  await login(page, identity(), {}, [], archive);
  const settings = await openSettings(page);
  await choice(settings).check();
  await expect(choice(settings)).toBeEnabled();
  expiredToken = registrations[0].token;
  const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/replacement';
  await page.evaluate(url => localStorage.setItem('qa-endpoint', url), endpoint);
  await reopen(page);
  await expect.poll(() => registrations.length).toBe(3);
  expect(registrations[1].token).toBe(expiredToken);
  expect(registrations[2].token).not.toBe(expiredToken);
  expect(registrations[2].subscription.endpoint).toBe(endpoint);
  await expect(choice(await openSettings(page))).toBeChecked();
  await page.evaluate(() => localStorage.setItem('qa-permission', 'default'));
  await reopen(page);
  await expect.poll(() => revocations.some(r => r.token === registrations[2].token)).toBe(true);
  await expect(choice(await openSettings(page))).not.toBeChecked();
});
test('only an accepted recipient copy triggers a push, and a push failure cannot fail or repeat a send', async ({ page }) => {
  const me=identity(), peer=identity(), own=relay(), other=relay(), notices=[];
  const dir=relay([inboxList(me,['own.test']), inboxList(peer,['peer.test'])]);
  await page.route('**/api/push/notify', route => {
    notices.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, body: '' });
  });
  other.rejectWrites=true;
  await login(page,me,{'dir.test':dir,'own.test':own,'peer.test':other},['dir.test'],archive);
  await newChat(page,peer);
  await page.getByPlaceholder('Type your message...').fill('Push fault isolation');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('No relay confirmed'); expect(notices).toHaveLength(0);
  other.rejectWrites=false; own.rejectWrites=true;
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('relay accepted'); await expect.poll(()=>notices.length).toBe(1);
  expect(notices[0]).toEqual(other.writes.at(-1));
  expect(JSON.stringify(notices[0])).not.toContain('Push fault isolation');
  expect(JSON.stringify(notices[0])).not.toContain(me.pk);
  await reopen(page); await page.getByRole('button',{name:peer.npub,exact:true}).click(); own.rejectWrites=false;
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText('Push fault isolation',{exact:true})).toBeVisible(); expect(notices).toHaveLength(1);
});

// Replace only the OS display boundary. CI headless browsers have no notification center.
const displayPrelude = `
  self.registration.showNotification = (title, options) => fetch('/qa/push-display', {
    method: 'POST', body: JSON.stringify({title, options})
  });
`;
test.describe('browser push delivery', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a stopped service worker wakes with every app tab closed and requests a generic notification', async ({ context, page, browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'Chromium exposes a protocol command to inject a push.');
    const displays = [];
    const origin = await servePwa(baseURL, async (request, response) => {
      if (request.url === '/qa/push-display') {
        const chunks = [];
        for await (const piece of request) chunks.push(piece);
        displays.push(JSON.parse(Buffer.concat(chunks).toString()));
        response.writeHead(204).end();
      } else if (request.url === '/push-worker.js') {
        const worker = await fetch(new URL(request.url, baseURL));
        response.writeHead(200, { 'Content-Type': 'application/javascript' });
        response.end(displayPrelude + await worker.text());
      } else return false;
      return true;
    });
    try {
      const { registrations } = await deviceFixture(page);
      const control = await context.newPage(); // about:blank stays off the app origin
      const protocol = await context.newCDPSession(control);
      let id;
      protocol.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const reg = registrations.find(r => r.scopeURL === origin.url + '/' && !r.isDeleted);
        if (reg) id = reg.registrationId;
      });
      await protocol.send('ServiceWorker.enable');
      await login(page, identity(), {}, [], archive, origin.url);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const settings = await openSettings(page);
      await choice(settings).check();
      await expect.poll(() => registrations.length).toBe(1);
      await expect(choice(settings)).toBeEnabled(); // registration committed to IndexedDB
      await expect.poll(() => id).toBeTruthy();
      await page.close();
      expect(context.pages().map(tab => tab.url())).toEqual(['about:blank']);
      await protocol.send('ServiceWorker.stopAllWorkers');
      const device = createHash('sha256').update(registrations[0].token).digest('hex');
      await protocol.send('ServiceWorker.deliverPushMessage', {
        origin: origin.url, registrationId: id, data: JSON.stringify({ v: 1, device }),
      });
      await expect.poll(() => displays).toEqual([{
        title: 'MeShell', options: { body: 'New activity in MeShell.', tag: 'meshell-activity' },
      }]);
      const reopened = await context.newPage();
      await reopened.goto(origin.url + '/lock');
      await expect(reopened.getByRole('heading', { name: 'Unlock MeShell' })).toBeVisible();
    } finally { await origin.disconnect(); }
  });
});
