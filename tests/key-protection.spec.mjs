import { test, expect } from '@playwright/test';
import { decrypt } from 'nostr-tools/nip49';
import { getPublicKey } from 'nostr-tools/pure';
import { bech32 } from '@scure/base';
import { identity, newChat, openSettings, setupPin, testPin, typePin, unlock } from './relay.mjs';

async function store(page, op, key, value) {
  return page.evaluate(({ op, key, value }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('SecureStorage', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('nsecStore');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('nsecStore', 'readwrite'), records = tx.objectStore('nsecStore');
      const result = op === 'put' ? records.put(value, key) : records.get(key);
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onabort = () => reject(tx.error);
    };
  }), { op, key, value });
}
async function isolated(page) {
  const sockets = [];
  await page.routeWebSocket(/.*/, ws => {
    sockets.push(ws.url());
    ws.onMessage(raw => { const [op,id]=JSON.parse(String(raw)); if(op==='REQ') ws.send(JSON.stringify(['EOSE', id])); });
  });
  await page.goto('/');
  return sockets;
}
async function tapPin(page, pin) {
  const buttons = page.getByRole('group', { name: 'PIN keypad' }).getByRole('button', { name: /^\d$/ });
  for (const [i,digit] of [...pin].entries()) {
    const old = await buttons.allTextContents();
    expect([...old].sort().join('')).toBe('0123456789');
    await page.getByRole('button', { name: digit, exact: true }).click();
    if (i < 5) {
      const after = await buttons.allTextContents();
      expect(after.every((v,k) => v !== old[k])).toBe(true);
    }
  }
}
test('migrates the deployed raw record only after PIN confirmation and keeps the same identity across a reload', async ({ page }) => {
  const me = identity(), sockets = await isolated(page);
  await store(page,'put','nsec',me.nsec);
  await page.evaluate(secret => localStorage.setItem('privateKey',secret), Buffer.from(me.sk).toString('hex'));
  await page.goto('/chat');
  await expect(page.getByRole('heading', {name:'Create your PIN'})).toBeVisible();
  await tapPin(page,testPin); await tapPin(page,'111111');
  await expect(page.getByRole('alert')).toContainText('didn’t match');
  expect(await store(page,'get','nsec') === me.nsec).toBe(true);
  expect(sockets).toHaveLength(0);
  await tapPin(page,testPin); await tapPin(page,testPin);
  await page.waitForURL('**/chat');
  const vault=await store(page,'get','vault');
  expect(vault.pk).toBe(me.pk); expect(getPublicKey(decrypt(vault.encrypted,testPin))).toBe(me.pk);
  expect(bech32.decodeToBytes(vault.encrypted,200).bytes[42]).toBe(0);
  expect(await store(page,'get','nsec')).toBeUndefined();
  expect(await page.evaluate(()=>localStorage.getItem('privateKey'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
  const count=sockets.length;
  await typePin(page,'111111'); await expect(page.getByRole('alert')).toContainText('didn’t unlock');
  expect(sockets).toHaveLength(count);
  expect((await store(page,'get','vault')).encrypted === vault.encrypted).toBe(true);
  await unlock(page);
  const settings=await openSettings(page); await settings.getByRole('button',{name:'Lock now'}).click();
  await expect(page.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
});
test('registration never persists a raw key and a matching backup can replace a forgotten PIN', async ({ page })=>{
  const sockets=await isolated(page);
  await page.getByRole('button',{name:'Register'}).click();
  await expect(page.getByRole('heading',{name:'Create your PIN'})).toBeVisible();
  expect(await store(page,'get','nsec')).toBeUndefined(); expect(await store(page,'get','vault')).toBeUndefined();
  expect(sockets).toHaveLength(0);
  await setupPin(page);
  const record=await store(page,'get','vault');
  expect(bech32.decodeToBytes(record.encrypted,200).bytes[42]).toBe(1);
  const { nsecEncode } = await import('nostr-tools/nip19');
  const backup=nsecEncode(decrypt(record.encrypted,testPin));
  await page.reload(); await page.getByRole('button',{name:'Use backup nsec'}).click();
  await page.getByLabel('Backup nsec').fill(identity().nsec); await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByRole('alert')).toContainText('for this account');
  await page.getByLabel('Backup nsec').fill(backup); await page.getByRole('button',{name:'Continue'}).click();
  await setupPin(page,'000051');
  const changed=await store(page,'get','vault');
  expect(changed.id).toBe(record.id); expect(getPublicKey(decrypt(changed.encrypted,'000051'))).toBe(record.pk);
});
test('an aborted database replacement preserves the old record and permits retry',async({page})=>{
  const me=identity(); await isolated(page); await store(page,'put','nsec',me.nsec); await page.reload();
  await page.getByRole('heading',{name:'Create your PIN'}).waitFor();
  await page.evaluate(()=>{
    const remove=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete=function(key){
      if(key==='nsec'){ this.transaction.abort(); IDBObjectStore.prototype.delete=remove; }
      return remove.call(this,key);
    };
  });
  await typePin(page); await page.getByRole('heading',{name:'Confirm your PIN'}).waitFor(); await typePin(page);
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await store(page,'get','nsec')===me.nsec).toBe(true); expect(await store(page,'get','vault')).toBeUndefined();
  await setupPin(page);
  expect((await store(page,'get','vault')).pk).toBe(me.pk);
});

function setHidden(page, hidden) {
  return page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('a brief switch keeps the draft, ten seconds locks, and key storage is not polled', async ({ page })=>{
  await page.clock.install();
  await page.addInitScript(()=>{
    window.keyReads=0;
    const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){
      if(this.name==='nsecStore' && (key==='vault'||key==='nsec'))window.keyReads++;
      return get.call(this,key);
    };
  });
  await isolated(page);
  await page.getByRole('button',{name:'Register'}).click(); await setupPin(page);
  await page.getByRole('button',{name:'Menu'}).waitFor();
  const count=await page.evaluate(()=>window.keyReads);
  await page.waitForTimeout(2150);
  expect(await page.evaluate(()=>window.keyReads)).toBe(count);
  await newChat(page, identity());
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(draft).toBeEditable(); await draft.fill('Keep my draft');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await setHidden(page, true);
  await expect(draft).toBeHidden();
  await page.clock.fastForward(9999);
  await setHidden(page, false);
  await expect(draft).toHaveValue('Keep my draft');
  await page.clock.fastForward(12000);
  await expect(draft).toBeVisible();
  await setHidden(page, true);
  await page.clock.fastForward(6000);
  await setHidden(page, true); // Duplicate lifecycle events cannot extend the deadline.
  await page.clock.fastForward(4000);
  await expect(page).toHaveURL(/\/lock$/);
  await setHidden(page, false);
  await expect(page.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
  await page.goto('/chat'); await expect(page.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
  const response = await page.goto('/lock');
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Unlock MeShell' })).toBeVisible();
});

test('resuming after a suspended timer or a history navigation requires the PIN', async ({ page }) => {
  await page.clock.install();
  await isolated(page);
  await page.getByRole('button', { name: 'Register' }).click(); await setupPin(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await setHidden(page, true);
  await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 10000));
  expect(new URL(page.url()).pathname).toBe('/chat'); // No background callback has run.
  await setHidden(page, false);
  const locked = page.getByRole('heading', { name: 'Unlock MeShell' });
  await expect(locked).toBeVisible();
  await page.clock.resume(); await unlock(page);
  await setHidden(page, true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await setHidden(page, false);
  await expect(locked).toBeVisible();
});

test('a manual lock in another tab or an undelivered account change cancels a brief switch', async ({ page, context }) => {
  await isolated(page);
  await page.getByRole('button', { name: 'Register' }).click(); await setupPin(page);
  const other = await context.newPage();
  await isolated(other); await unlock(other);
  const settings = await openSettings(other);
  await setHidden(page, true);
  await settings.getByRole('button', { name: 'Lock now' }).click();
  const pin = page.getByRole('heading', { name: 'Unlock MeShell' });
  await expect(other.getByRole('heading', { name: 'Unlock MeShell' })).toBeVisible();
  await setHidden(page, false);
  await expect(pin).toBeVisible();
  await unlock(page);
  await setHidden(page, true);
  // Change the marker without delivering a storage event to this document, as on a suspended tab.
  await page.evaluate(() => localStorage.setItem('meshell:account-change', crypto.randomUUID()));
  expect(new URL(page.url()).pathname).toBe('/chat');
  await setHidden(page, false);
  await expect(pin).toBeVisible();
});

test('competing PIN migrations leave one verified record and preserve the original account', async ({ page, context })=>{
  const me=identity(), pins=['022135','074628'];
  await isolated(page); await store(page,'put','nsec',me.nsec); await page.reload();
  const other=await context.newPage();
  await other.routeWebSocket(/.*/, ws=>ws.onMessage(raw=>{const [op,id]=JSON.parse(String(raw));if(op==='REQ')ws.send(JSON.stringify(['EOSE',id]));}));
  await other.goto('/chat');
  await Promise.all([page,other].map(async (tab,i)=>{
    await tab.getByRole('heading',{name:'Create your PIN'}).waitFor();
    await typePin(tab,pins[i]);
    await tab.getByRole('heading',{name:'Confirm your PIN'}).waitFor();
  }));
  await Promise.all([typePin(page,pins[0]),typePin(other,pins[1])]);
  await expect.poll(async()=>!!await store(page,'get','vault')).toBe(true);
  const vault=await store(page,'get','vault');
  const valid=pins.filter(pin=>{try{return getPublicKey(decrypt(vault.encrypted,pin))===me.pk;}catch{return false;}});
  expect(valid).toHaveLength(1); expect(await store(page,'get','nsec')).toBeUndefined();
  await other.close(); await page.reload(); await unlock(page,valid[0]);
});
test('a changed public key prevents unlock and preserves the encrypted record', async ({page})=>{
  await isolated(page); await page.getByRole('button',{name:'Register'}).click(); await setupPin(page);
  const vault=await store(page,'get','vault');
  const changed={...vault,pk:identity().pk}; await store(page,'put','vault',changed); await page.reload();
  await page.getByRole('heading',{name:'Unlock MeShell'}).waitFor();
  await typePin(page); await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByRole('button',{name:'Menu'})).toHaveCount(0);
  expect((await store(page,'get','vault')).encrypted===vault.encrypted).toBe(true);
});
