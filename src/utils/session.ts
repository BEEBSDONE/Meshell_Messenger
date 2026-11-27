import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Account } from './privateMessages';
import { commitKeys, decodeNsec, legacyAccount, readKeys, type Vault } from './secureStorage';
import { processKey } from './keyWorker';
import { removeDarkMode, removeRelays } from './storage';

type Setup = { mode: 'setup'; source: 'legacy' | 'register' | 'import' | 'recovery'; pk: string; vault?: Vault };
type Session = { mode: 'loading' | 'empty' } | { mode: 'error'; message: string } | Setup |
  { mode: 'locked'; vault: Vault } | { mode: 'open'; account: Account; vault: Vault; fresh: boolean };

const changeKey = 'meshell:account-change';
const backgroundGraceMs = 10_000;
const listeners = new Set<() => void>();
let state: Session = { mode: 'loading' };
let lifetime = new AbortController();
let pending: Uint8Array | undefined;
let channel: BroadcastChannel | undefined;
let lastNotice = '';
let background: { wallTime: number; monotonicTime: number; accountNotice: string | null; timer: number } | undefined;

export const sessionSnapshot = () => state;
export function subscribeSession(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
function update(next: Session) { state = next; listeners.forEach(fn => fn()); }
function cancelBackgroundLock() {
  if (background) window.clearTimeout(background.timer);
  background = undefined;
}
function reset() {
  cancelBackgroundLock();
  lifetime.abort();
  lifetime = new AbortController();
  if (state.mode === 'open') state.account.sk.fill(0);
  pending?.fill(0); pending = undefined;
}
function lockBackgroundSession() {
  if (state.mode !== 'open') return;
  const { vault } = state;
  reset();
  update({ mode: 'locked', vault });
}
function currentAccountNotice() {
  try { return localStorage.getItem(changeKey); } catch { return null; }
}
function notify() {
  const id = crypto.randomUUID();
  try { localStorage.setItem(changeKey, id); } catch { /* BroadcastChannel also reaches open tabs. */ }
  try { channel?.postMessage(id); } catch { /* The storage signal was sent independently. */ }
}
export async function refreshSession() {
  reset();
  const { signal } = lifetime;
  update({ mode: 'loading' });
  try {
    const record = await readKeys();
    if (signal.aborted) return;
    const old = legacyAccount(record);
    old?.sk.fill(0);
    if (record.vault) update({ mode: 'locked', vault: record.vault });
    else if (old) update({ mode: 'setup', source: 'legacy', pk: old.pk });
    else update({ mode: 'empty' });
  } catch {
    if (!signal.aborted) update({ mode: 'error', message: 'MeShell couldn’t read a single valid account from this device. Your saved keys have been preserved.' });
  }
}
export function startSession() {
  const invalidate = (id: string) => {
    if (lastNotice === id) return;
    lastNotice = id; void refreshSession();
  };
  try {
    channel = new BroadcastChannel(changeKey);
    channel.onmessage = e => { if (typeof e.data === 'string') invalidate(e.data); };
  } catch { /* storage events cover browsers without BroadcastChannel. */ }
  window.addEventListener('storage', e => {
    if (e.key === changeKey && e.newValue) invalidate(e.newValue);
    else if (e.key === null || e.key === 'privateKey' || e.key === 'nsec') void refreshSession();
  });
  const leavePage = () => {
    document.documentElement.setAttribute('data-meshell-hidden', '');
    reset(); update({ mode: 'loading' });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.mode !== 'open') { leavePage(); return; }
      document.documentElement.setAttribute('data-meshell-hidden', '');
      if (!background) background = {
        wallTime: Date.now(), monotonicTime: performance.now(), accountNotice: currentAccountNotice(),
        timer: window.setTimeout(lockBackgroundSession, backgroundGraceMs),
      };
      return;
    }
    // A suspended tab may have missed a lock or logout in another window.
    if (state.mode === 'loading' || (background && background.accountNotice !== currentAccountNotice())) {
      void refreshSession();
    } else if (background) {
      // Suspended tabs can resume before their timeout runs. Check elapsed time before revealing chat.
      const elapsed = Date.now() - background.wallTime;
      if (elapsed < 0 || elapsed >= backgroundGraceMs || performance.now() - background.monotonicTime >= backgroundGraceMs) {
        lockBackgroundSession();
      } else cancelBackgroundLock();
    }
    document.documentElement.removeAttribute('data-meshell-hidden');
  });
  window.addEventListener('pagehide', leavePage);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    void refreshSession();
    if (!document.hidden) document.documentElement.removeAttribute('data-meshell-hidden');
  });
  void refreshSession();
}
export function beginSetup(nsec?: string) {
  const before = state;
  if (before.mode !== 'empty' && !(before.mode === 'locked' && nsec)) throw Error('Account setup is unavailable.');
  const sk = nsec === undefined ? generateSecretKey() : decodeNsec(nsec.trim());
  const pk = getPublicKey(sk);
  if (before.mode === 'locked' && pk !== before.vault.pk) {
    sk.fill(0); throw Error('This nsec belongs to another account.');
  }
  reset(); pending = sk;
  update({ mode: 'setup', pk, source: before.mode === 'locked' ? 'recovery' : nsec ? 'import' : 'register',
    vault: before.mode === 'locked' ? before.vault : undefined });
}
function sameVault(a?: Vault, b?: Vault) {
  return a?.id === b?.id && a?.pk === b?.pk && a?.encrypted === b?.encrypted;
}
export async function enterPin(pin: string) {
  const before = state;
  if (!/^\d{6}$/.test(pin) || (before.mode !== 'locked' && before.mode !== 'setup')) throw Error('Enter six digits.');
  const { signal } = lifetime;
  const record = await readKeys();
  signal.throwIfAborted();
  if (!sameVault(record.vault, before.vault)) { void refreshSession(); throw Error('Account changed. Try again.'); }
  const old = legacyAccount(record);
  let unlocked: Uint8Array | undefined;
  try {
    let vault = record.vault;
    if (before.mode === 'locked') {
      const result = await processKey({ operation: 'unlock', pk: before.vault.pk, encrypted: before.vault.encrypted, pin }, signal);
      unlocked = result.sk;
      if (old) await commitKeys(record, before.vault, signal);
      else if (!sameVault((await readKeys()).vault, before.vault)) {
        void refreshSession(); throw Error('The saved account changed. Reopen MeShell.');
      }
    } else {
      const sk = before.source === 'legacy' ? old?.sk : pending;
      if (!sk || (old && old.pk !== before.pk) || getPublicKey(sk) !== before.pk) throw Error('The saved account changed. Reopen MeShell.');
      const result = await processKey({ operation: 'protect', pk: before.pk, sk, pin, fresh: before.source === 'register' }, signal);
      unlocked = result.sk;
      vault = { version: 1, pk: before.pk, id: vault?.id ?? crypto.randomUUID(), encrypted: result.encrypted };
      await commitKeys(record, vault, signal);
      notify();
    }
    signal.throwIfAborted();
    if (!vault || !unlocked) throw Error('Unable to unlock this account.');
    pending?.fill(0); pending = undefined;
    update({ mode: 'open', vault, account: { pk: vault.pk, sk: unlocked }, fresh: before.mode === 'setup' && before.source === 'register' });
    unlocked = undefined;
  } finally { old?.sk.fill(0); unlocked?.fill(0); }
}
export function lockNow() { notify(); void refreshSession(); }
export async function logout() {
  if (state.mode !== 'open') return;
  const { vault } = state, { signal } = lifetime;
  const record = await readKeys();
  if (!sameVault(record.vault, vault)) { void refreshSession(); throw Error('Account changed.'); }
  legacyAccount(record)?.sk.fill(0);
  await commitKeys(record, undefined, signal);
  reset();
  update({ mode: 'loading' });
  notify();
  try { removeDarkMode(); removeRelays(); } catch { /* Optional settings may already be unavailable. */ }
  window.location.replace('/');
}
