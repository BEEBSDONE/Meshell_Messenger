import type { Event, Filter } from 'nostr-tools';
import type { AbstractRelay, Subscription } from 'nostr-tools/abstract-relay';
import type { SimplePool } from 'nostr-tools/pool';

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 1000;
const TIMEOUT = 10_000;

export type RelaySyncState = 'checking' | 'synced' | 'failed';
export type RelayStates = Record<string, RelaySyncState>;

export interface HistoryStatus {
  loading: boolean;
  hasOlder: boolean;
  failed: boolean;
  total: number;
  crowded: boolean;
  byRelay: RelayStates;
}

interface Cursor {
  until?: number;
  limit: number;
}

interface Direction {
  cursor: Cursor | null;
  failed: boolean;
}

interface Source {
  url: string;
  directions: Direction[];
  live?: Subscription;
  busy: boolean;
  failed: boolean;
}

export function dmFilters(account: string, peer?: string): Filter[] {
  const incoming: Filter = { kinds: [4], '#p': [account] };
  const outgoing: Filter = { kinds: [4], authors: [account] };
  if (peer) {
    incoming.authors = [peer];
    outgoing['#p'] = [peer];
  }
  return [incoming, outgoing];
}

export function conversationPeer(event: Event, account: string): string | undefined {
  const recipient = event.tags.find(tag => tag[0] === 'p')?.[1];
  if (event.kind !== 4 || !recipient || !/^[a-f0-9]{64}$/.test(recipient)) return;
  if (event.pubkey === account) return recipient;
  if (recipient === account) return event.pubkey;
}

// nostr-tools 2.7 also calls oneose on its own timer. Our earlier deadline
// keeps a timeout or CLOSED response retryable instead of marking history complete.
function readPage(relay: AbstractRelay, filter: Filter, signal: AbortSignal, receive: (event: Event) => boolean) {
  return new Promise<{ oldest: number; count: number; added: boolean }>((resolve, reject) => {
    let oldest = Infinity;
    let added = false;
    const ids = new Set<string>();
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      subscription.close();
      if (error) reject(error);
      else resolve({ oldest, count: ids.size, added });
    };
    const abort = () => finish(new Error('History request cancelled'));
    const subscription = relay.prepareSubscription([filter], {
      eoseTimeout: TIMEOUT * 2,
      onevent(event) {
        if (finished || ids.has(event.id)) return;
        ids.add(event.id);
        oldest = Math.min(oldest, event.created_at);
        if (receive(event)) added = true;
      },
      oneose: () => finish(),
      onclose: () => finish(new Error('Relay closed history request')),
    });
    const timer = setTimeout(() => finish(new Error('Relay history timed out')), TIMEOUT);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else subscription.fire();
  });
}

export function openHistory(
  pool: SimplePool, urls: string[], filters: Filter[],
  onEvent: (event: Event) => void, onStatus: (status: HistoryStatus) => void,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const seen = new Set<string>();
  let crowded = false;
  const sources: Source[] = urls.map(url => ({
    url, directions: filters.map(() => ({ cursor: { limit: PAGE_SIZE }, failed: false })),
    busy: false, failed: false,
  }));

  function report() {
    if (signal.aborted) return;
    const byRelay: RelayStates = {};
    for (const source of sources) {
      if (source.busy) byRelay[source.url] = 'checking';
      else if (source.failed || source.directions.some(d => d.failed)) byRelay[source.url] = 'failed';
      else if (!source.live) byRelay[source.url] = 'checking';
      else byRelay[source.url] = 'synced';
    }
    onStatus({
      loading: sources.some(s => s.busy),
      hasOlder: sources.some(s => !s.failed && s.directions.some(d => !d.failed && d.cursor !== null)),
      failed: Object.values(byRelay).includes('failed'), byRelay,
      total: sources.length, crowded,
    });
  }

  function receive(event: Event) {
    if (signal.aborted || seen.has(event.id)) return false;
    seen.add(event.id);
    onEvent(event);
    return true;
  }

  async function page(relay: AbstractRelay, direction: Direction, filter: Filter) {
    direction.failed = false;
    try {
      // A page can consist only of the inclusive boundary. Advance once more in
      // the same action so a repeated event does not look like the end of history.
      for (let attempt = 0; attempt < 2 && direction.cursor; attempt++) {
        const cursor: Cursor = direction.cursor;
        const { oldest, count, added } = await readPage(relay, { ...filter, ...cursor }, signal, receive);
        if (count === 0) direction.cursor = null;
        else if (oldest !== cursor.until) direction.cursor = { until: oldest, limit: PAGE_SIZE };
        else if (count >= cursor.limit && cursor.limit < MAX_PAGE_SIZE) {
          direction.cursor = { until: oldest, limit: Math.min(cursor.limit * 2, MAX_PAGE_SIZE) };
        } else {
          if (count >= cursor.limit || (cursor.limit > PAGE_SIZE && count >= PAGE_SIZE)) crowded = true;
          direction.cursor = oldest > 0 ? { until: oldest - 1, limit: PAGE_SIZE } : null;
        }
        if (added || oldest !== cursor.until) break;
      }
    } catch {
      direction.failed = true;
    }
  }

  async function load(source: Source, retryOnly = false) {
    if (source.busy || signal.aborted) return;
    const reconnect = !source.live;
    if (retryOnly && !reconnect && !source.directions.some(d => d.failed)) return;
    source.busy = true;
    report();
    try {
      const relay = await pool.ensureRelay(source.url, { connectionTimeout: TIMEOUT });
      if (signal.aborted) return;
      if (reconnect) {
        source.failed = false;
        source.live = relay.subscribe(filters.map(f => ({ ...f, limit: 0 })), {
          onevent: receive,
          onclose: () => {
            source.live = undefined;
            source.failed = true;
            report();
          },
        });
        // Refetch the head to cover messages that arrived during disconnection.
        for (const d of source.directions) d.cursor = { limit: PAGE_SIZE };
      }
      await Promise.all(source.directions.map((d, i) => {
        if (d.cursor && (reconnect || (retryOnly ? d.failed : !d.failed))) return page(relay, d, filters[i]);
      }));
    } catch {
      source.failed = true;
    } finally {
      source.busy = false;
      report();
    }
  }

  for (const s of sources) void load(s);
  report();
  return {
    loadOlder: () => sources.filter(s => !s.failed && s.directions.some(d => d.cursor && !d.failed)).forEach(s => void load(s)),
    retry: () => sources.filter(s => s.failed || s.directions.some(d => d.failed)).forEach(s => void load(s, true)),
    close() {
      controller.abort();
      for (const s of sources) s.live?.close();
    },
  };
}
