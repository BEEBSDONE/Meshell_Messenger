import type { Event } from 'nostr-tools';
import { validateEvent, verifyEvent } from 'nostr-tools/pure';
import { conversationPeer } from './history';

// This is Primal's public cache API, distinct from its ordinary Nostr relay.
const ENDPOINT = 'wss://cache2.primal.net/v1';
const PAGE_SIZE = 40;
const TIMEOUT = 15_000;
const HEX_KEY = /^[0-9a-f]{64}$/;
const CONTACT_COUNTS = 10_000_118;
const PAGE_RANGE = 10_000_113;

type Method = 'get_directmsg_contacts' | 'get_directmsgs';
type Params = Record<string, string | number>;
type CacheItem = Record<string, unknown>;
interface PendingRequest {
  send: () => void;
  item: (data: CacheItem) => void;
  finish: (error?: Error) => void;
}

function record(value: unknown): value is CacheItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function content(item: CacheItem): CacheItem | undefined {
  if (typeof item.content !== 'string') return;
  try {
    const value: unknown = JSON.parse(item.content);
    if (record(value)) return value;
  } catch { /* An unreadable cache hint cannot identify a message. */ }
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function signed(item: CacheItem): Event | undefined {
  if (!timestamp(item.created_at) || typeof item.id !== 'string' || !HEX_KEY.test(item.id) ||
      typeof item.sig !== 'string' || !/^[0-9a-f]{128}$/.test(item.sig) || !validateEvent(item)) return;
  const event = item as unknown as Event;
  return verifyEvent(event) ? event : undefined;
}

export interface ArchiveCursor {
  until: number;
  offset: number;
  previous?: string;
}

// One read-only cache connection per enabled account. It is never a publish
// target. In-flight inbox and thread requests are separated by subscription ID.
export class PrimalHistory {
  private socket?: WebSocket;
  private serial = 0;
  private pending = new Map<string, PendingRequest>();
  private latest = new Map<string, Event>();

  constructor(private account: string, private onProfile: (event: Event) => void) {}

  latestMessage(peer: string) { return this.latest.get(peer); }

  private disconnect() {
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  close() {
    this.disconnect();
    for (const request of this.pending.values()) request.finish(new Error('Primal history closed'));
    this.latest.clear();
  }

  private connect() {
    if (this.socket) return this.socket;
    const socket = new WebSocket(ENDPOINT);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) for (const request of this.pending.values()) request.send();
    };
    const fail = () => {
      if (this.socket !== socket) return;
      this.disconnect();
      for (const request of this.pending.values()) request.finish(new Error('Primal history unavailable'));
    };
    socket.onerror = fail;
    socket.onclose = fail;
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket || typeof data !== 'string') return;
      let frame: unknown;
      try { frame = JSON.parse(data); } catch { return; }
      if (!Array.isArray(frame)) return;
      if (frame[0] === 'NOTICE' && frame.length === 2) { fail(); return; }
      const request = this.pending.get(frame[1]);
      if (!request) return;
      if (frame[0] === 'EVENT' && record(frame[2])) request.item(frame[2]);
      else if (frame[0] === 'EOSE') request.finish();
      else if (frame[0] === 'NOTICE' || frame[0] === 'CLOSED') request.finish(new Error('Primal declined the request'));
    };
    return socket;
  }

  private query(method: Method, params: Params, signal: AbortSignal, item: PendingRequest['item']) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Cancelled')); return; }
      const socket = this.connect();
      const id = 'meshell-' + ++this.serial;
      const finish = (error?: Error) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error && socket.readyState === WebSocket.OPEN) {
          try { socket.send(JSON.stringify(['CLOSE', id])); } catch { /* The socket already closed. */ }
        }
        if (error && !this.pending.size && this.socket === socket) this.disconnect();
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new Error('Cancelled'));
      const timer = setTimeout(() => finish(new Error('Primal history timed out')), TIMEOUT);
      signal.addEventListener('abort', abort, { once: true });
      const send = () => {
        try { socket.send(JSON.stringify(['REQ', id, { cache: [method, params] }])); }
        catch { finish(new Error('Primal history unavailable')); }
      };
      this.pending.set(id, { send, finish, item });
      if (socket.readyState === WebSocket.OPEN) send();
    });
  }

  async page(peer: string | undefined, cursor: ArchiveCursor, signal: AbortSignal, onEvent: (event: Event) => void): Promise<ArchiveCursor | null> {
    const rows = new Map<string, number>();
    const peers = new Set<string>();
    const profiles = new Map<string, Event>();
    let range: string[] | undefined;
    const accept = (item: CacheItem, expectedPeer?: string) => {
      if (item.kind !== 0 && item.kind !== 4) return;
      const event = signed(item);
      if (!event) return;
      if (event.kind === 0) {
        const previous = profiles.get(event.pubkey);
        if (!previous || event.created_at > previous.created_at ||
            (event.created_at === previous.created_at && event.id < previous.id)) profiles.set(event.pubkey, event);
        return;
      }
      const other = conversationPeer(event, this.account);
      if (!other || (expectedPeer && expectedPeer !== other)) return;
      peers.add(other);
      const id = peer ? event.id : other;
      rows.set(id, Math.max(rows.get(id) ?? 0, event.created_at));
      const latest = this.latest.get(other);
      if (!latest || event.created_at > latest.created_at) this.latest.set(other, event);
      onEvent(event);
    };

    const method = peer ? 'get_directmsgs' : 'get_directmsg_contacts';
    const params: Params = peer ? { receiver: this.account, sender: peer } : { user_pubkey: this.account, relation: 'any' };
    await this.query(method, { ...params, limit: PAGE_SIZE, until: cursor.until, offset: cursor.offset }, signal, item => {
      if (item.kind === PAGE_RANGE) {
        const hints = content(item);
        if (hints?.order_by === (peer ? 'created_at' : 'latest_at') && Array.isArray(hints.elements)) {
          range = hints.elements.filter((id): id is string => typeof id === 'string' && HEX_KEY.test(id)).slice(0, PAGE_SIZE);
        }
      } else if (!peer && item.kind === CONTACT_COUNTS) {
        for (const [id, info] of Object.entries(content(item) ?? {}).slice(0, PAGE_SIZE)) {
          if (HEX_KEY.test(id) && record(info) && timestamp(info.latest_at)) rows.set(id, info.latest_at);
        }
      } else accept(item, peer);
    });

    // The contact index can omit the latest event. Confirm each such hint
    // with a signed DM before showing it as a conversation. Limit concurrency.
    let previewsFailed = false;
    if (!peer) {
      const missing = [...new Set([...(range ?? []), ...rows.keys()])].filter(id => !peers.has(id)).slice(0, PAGE_SIZE);
      for (let i = 0; i < missing.length; i += 3) {
        const results = await Promise.allSettled(missing.slice(i, i + 3).map(sender => this.query('get_directmsgs',
          { receiver: this.account, sender, until: cursor.until, limit: 1 }, signal, item => accept(item, sender))));
        if (results.some(result => result.status === 'rejected')) previewsFailed = true;
        if (signal.aborted || results.every(result => result.status === 'rejected')) break;
      }
    }
    if (signal.aborted) throw new Error('Cancelled');
    for (const id of peers) {
      const profile = profiles.get(id);
      if (profile) this.onProfile(profile);
    }
    if (previewsFailed) throw new Error('Some Primal conversations could not be read');

    // Primal's range lists page rows (peers for contacts, event IDs for a
    // thread). Extra profile/stat frames never count toward the next offset.
    const ids = range?.length ? range : [...rows.keys()];
    if (!ids.length) return null;
    const fingerprint = ids.join(',');
    if (fingerprint === cursor.previous) throw new Error('Primal repeated the last page');
    let until = cursor.until;
    let offset = cursor.offset + ids.length;
    // Contact timestamps aggregate both directions. Changing their cutoff can
    // reintroduce a peer whose last sent and received messages are far apart.
    if (peer && ids.every(id => rows.has(id))) {
      const times = ids.map(id => rows.get(id)!);
      const oldest = Math.min(...times);
      if (oldest < until) {
        until = oldest;
        offset = times.filter(t => t === until).length;
      }
    }
    return { until, offset, previous: fingerprint };
  }
}
