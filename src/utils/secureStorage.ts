import { openDB } from 'idb';
import { getPublicKey } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';

export const STORE = 'nsecStore';
export interface Vault { version: 1; id: string; pk: string; encrypted: string }
export interface StoredKeys { vault?: Vault; legacy?: string; aliases: (string | null)[] }
const aliasNames = ['nsec', 'privateKey'];

export function deviceDB() {
  return openDB('SecureStorage', 1, { upgrade(db) { db.createObjectStore(STORE); } });
}
export function decodeNsec(value: string): Uint8Array {
  const key = decode(value);
  if (key.type !== 'nsec') throw Error('Invalid saved private key.');
  return key.data;
}
export function legacyAccount(record: StoredKeys): { sk: Uint8Array; pk: string } | undefined {
  const values = [record.legacy, ...record.aliases].filter((v): v is string => v !== null && v !== undefined);
  let account: { sk: Uint8Array; pk: string } | undefined;
  for (const value of new Set(values)) {
    const sk = /^[a-f\d]{64}$/i.test(value) ? Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16)) : decodeNsec(value);
    const pk = getPublicKey(sk);
    const previous = account?.sk;
    if ((previous && !sk.every((byte, i) => byte === previous[i])) || (record.vault && record.vault.pk !== pk)) {
      sk.fill(0); account?.sk.fill(0);
      throw Error('This device holds conflicting account keys. The saved keys have been preserved.');
    }
    if (account) sk.fill(0);
    else account = { sk, pk };
  }
  return account;
}
function aliases() { return aliasNames.map(name => localStorage.getItem(name)); }
export async function readKeys(): Promise<StoredKeys> {
  const db = await deviceDB();
  try {
    const tx = db.transaction(STORE);
    const [vault, legacy] = await Promise.all([tx.store.get('vault'), tx.store.get('nsec')]);
    if (vault !== undefined && (vault?.version !== 1 || typeof vault.id !== 'string' ||
      !/^[a-f\d]{64}$/.test(vault.pk) || typeof vault.encrypted !== 'string')) throw Error('Unreadable saved account.');
    if (legacy !== undefined && typeof legacy !== 'string') throw Error('Unreadable legacy key.');
    return { vault, legacy, aliases: aliases() };
  } finally { db.close(); }
}
export const historyRange = (id: string) => IDBKeyRange.bound(['message', id], ['message', id, []]);

// Compare again inside the write transaction. Another tab may have finished setup or logged out during scrypt.
export async function commitKeys(before: StoredKeys, next: Vault | undefined, signal: AbortSignal) {
  const db = await deviceDB();
  try {
    const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
    const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const [vault, legacy] = await Promise.all([tx.store.get('vault'), tx.store.get('nsec')]);
      if (signal.aborted || vault?.id !== before.vault?.id || vault?.pk !== before.vault?.pk ||
        vault?.encrypted !== before.vault?.encrypted || legacy !== before.legacy ||
        aliases().some((value, i) => value !== before.aliases[i])) throw Error('The saved account changed. Reopen MeShell and try again.');
      if (next) await tx.store.put(next, 'vault');
      else if (vault) {
        await tx.store.delete('vault');
        await tx.store.delete(['history', vault.id]);
        await tx.store.delete(historyRange(vault.id));
      }
      await tx.store.delete('nsec');
      await tx.done;
    } catch (error) {
      abort(); await tx.done.catch(() => {}); throw error;
    } finally { signal.removeEventListener('abort', abort); }
    // Older localStorage aliases can only be removed after IndexedDB has committed.
    aliasNames.forEach((name, i) => {
      if (before.aliases[i] !== null && localStorage.getItem(name) === before.aliases[i]) localStorage.removeItem(name);
    });
  } finally { db.close(); }
}
