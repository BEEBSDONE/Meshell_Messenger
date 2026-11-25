import { openDB } from 'idb';
import type { PrivateDraft } from './privateMessages';

// Only sealed envelopes and acknowledgements survive a reload. The account and
// peer form the key so tabs retry the same envelope for an unfinished send.
function database() {
  return openDB('MeShellMessageOutbox', 1, { upgrade(db) { db.createObjectStore('pending'); } });
}

export async function pendingPeers(account: string): Promise<string[]> {
  const db = await database();
  try {
    const keys = await db.getAllKeys('pending', IDBKeyRange.bound([account, ''], [account, '\uffff']));
    return keys.map(key => (key as string[])[1]);
  } finally { db.close(); }
}

export async function pendingMessage(account: string, peer: string): Promise<PrivateDraft | undefined> {
  const db = await database();
  try { return await db.get('pending', [account, peer]); } finally { db.close(); }
}

export async function reserveMessage(account: string, draft: PrivateDraft): Promise<PrivateDraft> {
  const db = await database();
  try {
    const tx = db.transaction('pending', 'readwrite');
    const key = [account, draft.peer];
    const previous: PrivateDraft | undefined = await tx.store.get(key);
    if (!previous) await tx.store.add(draft, key);
    await tx.done;
    return previous ?? draft;
  } finally { db.close(); }
}

export async function updatePending(account: string, draft: PrivateDraft, action: 'delivered' | 'complete' | 'discard') {
  const db = await database();
  try {
    const tx = db.transaction('pending', 'readwrite');
    const key = [account, draft.peer];
    const current: PrivateDraft | undefined = await tx.store.get(key);
    if (current?.toPeer.id === draft.toPeer.id) {
      if (action === 'delivered') await tx.store.put({ ...current, delivered: true }, key);
      else if (action === 'complete' || !current.delivered) await tx.store.delete(key);
    }
    await tx.done;
  } finally { db.close(); }
}
