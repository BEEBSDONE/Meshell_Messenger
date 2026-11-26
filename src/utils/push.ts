import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { getToken } from 'nostr-tools/nip98';
import type { Account } from './privateMessages';
import { sessionSnapshot } from './session';
import { deviceDB, PUSH_DEVICE, retirePush, STORE, type PushDevice } from './secureStorage';

type Revocation = Pick<PushDevice, 'account' | 'token' | 'endpoint'>;
const api = '/api/push/';
const queueRange = () => IDBKeyRange.bound(['push-revoke'], ['push-revoke', []]);
export const changeEvent = 'meshell:push-change';
function changed() {
  window.dispatchEvent(new Event(changeEvent));
  try { localStorage.setItem(changeEvent, crypto.randomUUID()); } catch { /* The database is authoritative. */ }
}
export const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function post(action: string, body: object, authorization?: string) {
  const data = JSON.stringify(body);
  return fetch(api + action, {
    method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(authorization && { Authorization: authorization }) },
    body: data, keepalive: data.length < 60000, signal: AbortSignal.timeout(12000),
  });
}
export function notifyRecipient(wrap: Event) {
  // Independent of both relay acknowledgements and the recipient's push preference.
  void post('notify', wrap).catch(() => {});
}
export async function readDevice(): Promise<PushDevice | undefined> {
  const db = await deviceDB();
  try { return await db.get(STORE, PUSH_DEVICE); } finally { db.close(); }
}
export async function pushSetup() {
  const [reg, res] = await Promise.all([
    navigator.serviceWorker.getRegistration(),
    fetch(api + 'key', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000) }),
  ]);
  if (!reg?.active || !res.ok) throw Error('Notifications are temporarily unavailable. Try again when online.');
  const { publicKey } = await res.json();
  if (typeof publicKey !== 'string' || !/^[\w-]{87}$/.test(publicKey)) throw Error('Notifications are temporarily unavailable.');
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return { reg, key };
}

async function saveDevice(candidate: PushDevice, expected?: string) {
  const db = await deviceDB();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const existing: PushDevice | undefined = await tx.store.get(PUSH_DEVICE);
    const vault = await tx.store.get('vault');
    if (vault?.id !== candidate.vaultId || vault.pk !== candidate.account || existing?.token !== expected) {
      await tx.done;
      throw Error('Device settings changed. Reopen Settings and try again.');
    }
    await tx.store.put(candidate, PUSH_DEVICE);
    await tx.done;
  } finally { db.close(); }
  changed();
}
export async function removeDevice(token: string) {
  const db = await deviceDB();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await retirePush(tx, token); await tx.done;
  } finally { db.close(); }
  changed();
  await flushRevocations();
}
let flushing: Promise<void> | undefined;
export function flushRevocations() {
  if (!flushing) flushing = cleanup().catch(() => {}).finally(() => { flushing = undefined; });
  return flushing;
}
async function cleanup() {
  const db = await deviceDB();
  try {
    const pending: Revocation[] = await db.getAll(STORE, queueRange());
    if (!pending.length) return;
    const reg = supported() ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
    for (const item of pending) {
      let localDone = true;
      if (reg && !await db.get(STORE, PUSH_DEVICE)) {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub?.endpoint === item.endpoint) await sub.unsubscribe();
          for (const alert of await reg.getNotifications({ tag: 'meshell-activity' })) alert.close();
        } catch { localDone = false; }
      }
      const res = await post('revoke', { account: item.account, token: item.token }).catch(() => undefined);
      if (res?.ok && localDone) await db.delete(STORE, ['push-revoke', item.token]);
    }
  } finally { db.close(); }
}

async function register(account: Account, vaultId: string, sub: PushSubscription, existing?: PushDevice) {
  const session = sessionSnapshot();
  if (session.mode !== 'open' || session.account !== account) throw Error('Unlock MeShell to finish setting up notifications.');
  const token = existing?.token ?? crypto.randomUUID();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const device = Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
  const marker = { account: account.pk, vaultId, device, token, endpoint: sub.endpoint, active: false };
  await saveDevice(marker, existing?.token);
  const body = { account: account.pk, token, subscription: sub.toJSON() };
  const auth = await getToken(new URL(api + 'subscribe', location.origin).href, 'POST',
    template => finalizeEvent(template, account.sk), true, body);
  const res = await post('subscribe', body, auth);
  if (!res.ok) throw Error(res.status === 409 ? 'Device registrations changed or are full. Try again.' : 'Could not register this device. Try again.');
  try { await saveDevice({ ...marker, active: true }, token); }
  catch (error) {
    // Logout or an opt-out may have committed while the signed registration was in flight.
    void post('revoke', { account: account.pk, token }).catch(() => {});
    throw error;
  }
}

export function enablePush(account: Account, vaultId: string, setup: Awaited<ReturnType<typeof pushSetup>>,
  existing?: PushDevice) {
  // Calling subscribe directly from the tap preserves the permission gesture on mobile browsers.
  const subscribing = setup.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: setup.key });
  return subscribing.then(sub => register(account, vaultId, sub, existing));
}
export async function reconcilePush(account: Account, vaultId: string) {
  const device = await readDevice();
  if (!device || device.vaultId !== vaultId || !supported()) return;
  if (Notification.permission === 'denied') { await removeDevice(device.token); return; }
  if (Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg?.active) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub && (sub.endpoint !== device.endpoint || !device.active)) await register(account, vaultId, sub, device);
  else if (!sub) {
    // A previous explicit opt-in and an existing browser grant allow silent endpoint repair.
    const setup = await pushSetup();
    await enablePush(account, vaultId, setup, device);
  }
}
