import { test, expect } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools/pure';
import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { dm, identity, inboxList, login, openSettings, relay, reopen, routeRelays, setupPin, unlock } from './relay.mjs';

const archive = ws => ws.onMessage(raw => { const [op,id] = JSON.parse(String(raw)); if (op === 'REQ') ws.send(JSON.stringify(['EOSE',id])); });
const opt = settings => settings.getByRole('checkbox', { name: 'Save encrypted messages for offline use' });
const chat = (page, peer) => page.getByRole('button', { name: peer.npub, exact: true });
const gift = (from,to,text) => createWrap(createSeal(createRumor({kind:14,tags:[['p',to.pk]],content:text},from.sk),from.sk,to.pk),to.pk);
async function rows(page, operation = 'list') {
  return page.evaluate(operation => new Promise((resolve,reject) => {
    const req=indexedDB.open('SecureStorage',1);
    req.onsuccess=()=>{
      const db=req.result, tx=db.transaction('nsecStore','readwrite'), store=tx.objectStore('nsecStore');
      const list=[], cur=store.openCursor();
      cur.onsuccess=()=>{
        const cursor=cur.result;
        if(!cursor)return;
        if(Array.isArray(cursor.key)&&cursor.key[0]==='message'){
          const row=cursor.value;
          list.push({key:cursor.key,fields:Object.keys(row).sort(),size:row.data.byteLength,ivSize:row.iv.length});
          if(operation==='damage-first' && list.length===1){
            new Uint8Array(row.data)[0]^=1; cursor.update(row);
          }
        }
        cursor.continue();
      };
      tx.oncomplete=()=>{db.close();resolve(list);};tx.onabort=()=>reject(tx.error);
    };
  }),operation);
}
test('opt-in stores only verified encrypted history and opens both formats offline after PIN unlock', async ({ page }) => {
  const me=identity(), peer=identity(), other=identity();
  const legacy=await dm(peer,me,120,'A legacy offline message');
  const modern=gift(peer,me,'A private offline message');
  const server=relay([legacy,modern,modern,inboxList(me,['chat.test']),
    { ...await dm(other,me,123,'forged text'), sig:'0'.repeat(128) },
    finalizeEvent({kind:4,tags:[['p',me.pk]],content:'invalid clear body',created_at:80},other.sk),
    gift(peer,other,'wrong recipient')]);
  await login(page,me,{'chat.test':server},undefined,archive);
  await chat(page,peer).click();
  for(const text of ['A legacy offline message','A private offline message']) await expect(page.getByText(text,{exact:true})).toBeVisible();
  const settings=await openSettings(page);
  await expect(opt(settings)).not.toBeChecked(); expect(await rows(page)).toEqual([]);
  await opt(settings).check();
  await expect.poll(async()=> (await rows(page)).length).toBe(2);
  const stored=await rows(page);
  for(const row of stored) {
    expect(row.fields).toEqual(['data','iv']); expect(row.ivSize).toBe(12); expect(row.size).toBeGreaterThan(100);
    expect(JSON.stringify(row.key)).not.toContain(peer.pk);
    expect([legacy.id,modern.id]).not.toContain(row.key[2]);
  }
  server.events=[]; server.silent=true;
  await page.reload(); await expect(page.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
  await expect(chat(page,peer)).toHaveCount(0);
  await unlock(page); await chat(page,peer).click();
  for(const text of ['A legacy offline message','A private offline message']) await expect(page.getByText(text,{exact:true})).toHaveCount(1);
  await expect(chat(page,other)).toHaveCount(0);
  await expect(page.getByText('Loading messages…', { exact:true })).toBeVisible();
  await rows(page,'damage-first'); await reopen(page); await chat(page,peer).click();
  await expect(page.getByText(/^(A legacy offline message|A private offline message)$/)).toHaveCount(1);
  const reopened=await openSettings(page);
  await expect(reopened).toContainText('Some saved messages could not be verified');
  await opt(reopened).uncheck(); await expect.poll(()=>rows(page)).toEqual([]);
  await reopen(page); await expect((await openSettings(page)).getByRole('checkbox',{name:'Save encrypted messages for offline use'})).not.toBeChecked();
  await expect(chat(page,peer)).toHaveCount(0);
});
test('disabling cached history in one tab purges it and prevents writes from the other tab',async({page,context})=>{
  const me=identity(), peer=identity(), server=relay([await dm(peer,me,10,'shared cache'),inboxList(me,['one.test'])]);
  await login(page,me,{'one.test':server},undefined,archive);
  const first=await openSettings(page); await opt(first).check();
  await expect.poll(async()=>(await rows(page)).length).toBe(1);
  const other=await context.newPage(); await routeRelays(other,{'one.test':server},archive);
  await other.goto('/chat'); await unlock(other); const second=await openSettings(other);
  await expect(opt(second)).toBeChecked(); await opt(second).uncheck(); await expect(opt(first)).not.toBeChecked();
  const fresh=await dm(peer,me,20,'online only');
  for(const entry of server.live) if(entry.filters.some(f=>f.kinds?.includes(4))) entry.deliver(fresh);
  await expect.poll(()=>rows(page)).toEqual([]);
  await first.getByRole('button',{name:'Lock now'}).click();
  await expect(other.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Unlock MeShell'})).toBeVisible();
});
test('logout clears offline rows and a different imported account starts with caching off',async({page})=>{
  const me=identity(), peer=identity(), another=identity(), server=relay([await dm(me,peer,10,'old account'),inboxList(me,['one.test'])]);
  await login(page,me,{'one.test':server},undefined,archive);
  const first=await openSettings(page); await opt(first).check(); await expect.poll(async()=>(await rows(page)).length).toBe(1);
  await first.getByRole('button',{name:'Logout'}).click();
  await page.getByRole('dialog',{name:'Log out of MeShell?'}).getByRole('button',{name:'Logout'}).click();
  await page.getByPlaceholder('Enter your nsec').fill(another.nsec); await page.getByRole('button',{name:'Login',exact:true}).click();
  await setupPin(page); const next=await openSettings(page); await expect(opt(next)).not.toBeChecked();
  expect(await rows(page)).toEqual([]); await expect(chat(page,peer)).toHaveCount(0);
});

test.describe('installed PWA', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the lock screen, key worker and cached chats reopen with the device offline', async ({ page, context }) => {
    const me = identity(), peer = identity();
    const server = relay([
      await dm(peer, me, 120, 'Offline legacy history'),
      gift(peer, me, 'Offline private history'),
      inboxList(me, ['chat.test']),
    ]);
    await login(page, me, { 'chat.test': server }, undefined, archive);
    const settings = await openSettings(page);
    await opt(settings).check();
    await expect.poll(async () => (await rows(page)).length).toBe(2);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    server.events = [];
    server.rejectReads = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Unlock MeShell' })).toBeVisible();
    await expect(chat(page, peer)).toHaveCount(0);
    await unlock(page);
    await chat(page, peer).click();
    await expect(page.getByText('Offline legacy history', { exact: true })).toBeVisible();
    await expect(page.getByText('Offline private history', { exact: true })).toBeVisible();
  });
});
