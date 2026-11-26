// Imported by the existing Workbox service worker. Only the push marker is read while locked.
async function pushDevice() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('SecureStorage', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('nsecStore');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('nsecStore').objectStore('nsecStore').get('push-device');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  });
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let message;
    try { message = event.data?.json(); } catch { return; }
    const current = await pushDevice();
    if (!current?.active || message?.v !== 1 || current.device !== message.device) return;
    await self.registration.showNotification('MeShell', {
      body: 'New activity in MeShell.', tag: 'meshell-activity',
    });
  })());
});
self.addEventListener('notificationclick', event => {
  if (event.notification.tag !== 'meshell-activity') return;
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window' });
    const app = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (app) { await app.focus(); return; }
    await self.clients.openWindow('/lock');
  })());
});
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const current = await pushDevice();
    if (!current?.active || self.Notification.permission !== 'granted') return;
    const next = event.newSubscription || (event.oldSubscription &&
      await self.registration.pushManager.subscribe(event.oldSubscription.options));
    if (!next) return;
    await fetch('/api/push/renew', {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: current.account, token: current.token, subscription: next.toJSON() }),
    });
    // If delivery or registration fails here, the next unlock reconciles the browser's subscription.
  })().catch(() => {}));
});
