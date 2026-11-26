import { verifyEvent, type Event } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import type { Account } from './privateMessages';
import { conversationPeer } from './history';
import { deviceDB, historyRange, STORE } from './secureStorage';

const utf8 = new TextEncoder();
const BATCH = 32;
interface Sealed { iv: Uint8Array; data: ArrayBuffer }
export interface CacheStatus { enabled: boolean; busy: boolean; error: string }
export const initialCacheStatus: CacheStatus = { enabled: false, busy: true, error: '' };

async function cacheKeys(sk: Uint8Array, id: string) {
  const source = await crypto.subtle.importKey('raw', new Uint8Array(sk), 'HKDF', false, ['deriveKey']);
  const params = (use: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(id), info: utf8.encode('MeShell offline history v1 ' + use) });
  const [cipher, index] = await Promise.all([
    crypto.subtle.deriveKey(params('content'), source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    crypto.subtle.deriveKey(params('index'), source, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
  ]);
  return { cipher, index };
}

// Store only signed wire events. The extra device encryption covers legacy sender/recipient tags
// and timestamps. The keyed index deduplicates deliveries without exposing public event IDs.
export class MessageCache {
  private db?: ReturnType<typeof deviceDB>;
  private keys?: ReturnType<typeof cacheKeys>;
  private token?: string;
  private generation = 0;
  private active = false;
  private known = new Map<string, Event>();
  private queued = new Map<string, Event>();
  private saved = new Set<string>();
  private flushing = false;
  private onBatch?: (events: Event[]) => void;
  private onStatus?: (status: CacheStatus) => void;
  private signalKey: string;
  constructor(private account: Account, private id: string) { this.signalKey = 'meshell:history:' + id; }

  start(onBatch: (events: Event[]) => void, onStatus: (status: CacheStatus) => void) {
    this.active = true; this.onBatch = onBatch; this.onStatus = onStatus;
    this.db = deviceDB();
    const refresh = (e: StorageEvent) => { if (e.key === this.signalKey || e.key === null) void this.refresh(); };
    window.addEventListener('storage', refresh);
    void this.refresh();
    return () => {
      window.removeEventListener('storage', refresh);
      this.active = false; this.generation++; this.token = undefined; this.keys = undefined;
      this.onBatch = undefined; this.onStatus = undefined;
      this.queued.clear(); this.known.clear(); this.saved.clear();
      void this.db?.then(db => db.close()).catch(() => {});
    };
  }
  private status(busy = false, error = '') { this.onStatus?.({ enabled: !!this.token, busy, error }); }
  private async refresh() {
    const generation = ++this.generation;
    try {
      const db = await this.db!;
      const token: string | undefined = await db.get(STORE, ['history', this.id]);
      if (!this.active || this.generation !== generation) return;
      this.token = token;
      this.queued.clear(); this.saved.clear();
      this.status();
      if (!token) { this.keys = undefined; return; }
      this.keys ??= cacheKeys(this.account.sk, this.id);
      for (const event of this.known.values()) this.queued.set(event.id, event);
      void this.flush();
      await this.restore(generation);
    } catch { if (this.active && this.generation === generation) this.status(false, 'Offline history could not be read on this device.'); }
  }
  async setEnabled(enabled: boolean) {
    if (!this.active) return;
    this.onStatus?.({ enabled, busy: true, error: '' });
    try {
      const db = await this.db!;
      const tx = db.transaction(STORE, 'readwrite');
      const vault = await tx.store.get('vault');
      if (vault?.id !== this.id || !this.active) { await tx.done; return; }
      const key = ['history', this.id];
      if (enabled) {
        if (!await tx.store.get(key)) await tx.store.put(crypto.randomUUID(), key);
      } else {
        await tx.store.delete(key);
        await tx.store.delete(historyRange(this.id));
      }
      await tx.done;
      try { localStorage.setItem(this.signalKey, crypto.randomUUID()); } catch { /* The DB preference is authoritative. */ }
      await this.refresh();
    } catch { this.status(false, 'Could not change offline history. Try again.'); }
  }
  // Gift wraps reach this method only after their seal and rumor have been authenticated.
  remember = (event: Event) => {
    if (this.known.has(event.id) || this.saved.has(event.id)) return;
    if (event.kind !== 4 && event.kind !== 1059) return;
    // Backfill recently viewed events if the user enables the cache mid-session.
    if (this.known.size >= 1000) this.known.delete(this.known.keys().next().value!);
    this.known.set(event.id, event);
    if (this.token && !this.saved.has(event.id)) { this.queued.set(event.id, event); void this.flush(); }
  };
  private async seal(event: Event, keys: Awaited<ReturnType<typeof cacheKeys>>) {
    if (!verifyEvent(event)) return;
    if (event.kind === 4) {
      const peer = conversationPeer(event, this.account.pk);
      if (!peer) return;
      try { await nip04.decrypt(this.account.sk, peer, event.content); } catch { return; }
    }
    const mac = await crypto.subtle.sign('HMAC', keys.index, utf8.encode(event.id));
    const index = Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join('');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(index) },
      keys.cipher, utf8.encode(JSON.stringify(event)));
    return { id: event.id, index, sealed: { iv, data } };
  }
  private async flush() {
    if (this.flushing || !this.token || !this.keys || !this.queued.size) return;
    this.flushing = true;
    const generation = this.generation, token = this.token;
    try {
      const keys = await this.keys, db = await this.db!;
      while (this.active && this.generation === generation && this.queued.size) {
        const batch: Event[] = [];
        for (const [id, event] of this.queued) { this.queued.delete(id); batch.push(event); if (batch.length === BATCH) break; }
        const rows = await Promise.all(batch.map(event => this.seal(event, keys)));
        if (!this.active || this.generation !== generation) return;
        const tx = db.transaction(STORE, 'readwrite');
        if (await tx.store.get(['history', this.id]) !== token) { await tx.done; return; }
        for (const row of rows) if (row) await tx.store.put(row.sealed, ['message', this.id, row.index]);
        await tx.done;
        for (const event of batch) { this.saved.add(event.id); this.known.delete(event.id); }
      }
    } catch {
      if (this.active && this.generation === generation) {
        this.queued.clear(); this.status(false, 'Some messages could not be saved on this device.');
      }
    } finally {
      this.flushing = false;
      if (this.active && this.generation !== generation) void this.flush();
    }
  }
  private async restore(generation: number) {
    const { cipher } = await this.keys!, db = await this.db!;
    let range = historyRange(this.id);
    let damaged = false;
    while (this.active && this.generation === generation) {
      const tx = db.transaction(STORE);
      const [keys, rows] = await Promise.all([tx.store.getAllKeys(range, BATCH), tx.store.getAll(range, BATCH)]);
      const events = await Promise.all(rows.map(async (row: Sealed, i) => {
        try {
          const index = (keys[i] as string[])[2];
          const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: utf8.encode(index) }, cipher, row.data);
          const event: Event = JSON.parse(new TextDecoder().decode(plain));
          if ((event.kind === 1059 || (event.kind === 4 && conversationPeer(event, this.account.pk))) && verifyEvent(event)) return event;
        } catch { /* A damaged row must not hide the rest of the inbox. */ }
        damaged = true;
      }));
      if (!this.active || this.generation !== generation) return;
      const verified = events.filter(event => event !== undefined);
      verified.forEach(event => this.saved.add(event.id));
      if (verified.length) this.onBatch?.(verified);
      if (rows.length < BATCH) break;
      range = IDBKeyRange.bound(keys[keys.length - 1], range.upper, true);
    }
    if (damaged) this.status(false, 'Some saved messages could not be verified.');
  }
}
