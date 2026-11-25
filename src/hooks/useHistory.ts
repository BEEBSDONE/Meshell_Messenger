import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Event, Filter } from 'nostr-tools';
import { dmFilters, openHistory, type HistoryStatus, type RelayStates } from '../utils/history';
import usePrimalHistory from './usePrimalHistory';
import type { PrimalHistory } from '../utils/primalHistory';
import { pool, type AuthSigner } from '../utils/nostr';

export function useRelayHistory(relays: string[], filters: Filter[], onEvent: (event: Event) => void, sign?: AuthSigner) {
  const active = useRef<ReturnType<typeof openHistory> | null>(null);
  const [status, setStatus] = useState<HistoryStatus>({
    loading: true, hasOlder: false, failed: false, total: relays.length, crowded: false, byRelay: {},
  });
  useEffect(() => {
    const history = openHistory(pool, filters.length ? relays : [], filters, onEvent, setStatus, sign);
    active.current = history;
    const onVisible = () => { if (!document.hidden) history.retry(); };
    window.addEventListener('online', history.retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', history.retry);
      document.removeEventListener('visibilitychange', onVisible);
      history.close();
      active.current = null;
    };
  }, [relays, filters, onEvent, sign]);
  const retry = useCallback(() => active.current?.retry(), []);
  const loadOlder = useCallback(() => active.current?.loadOlder(), []);
  return { status, loadOlder, retry };
}
export type RelayHistory = ReturnType<typeof useRelayHistory>;

export default function useHistory(relays: string[], account: string, peer: string | undefined,
  onEvent: (event: Event) => void, archive: PrimalHistory | null, gifts: RelayHistory, readLegacy = true) {
  const primal = usePrimalHistory(archive, peer, onEvent);
  const filters = useMemo(() => account && readLegacy ? dmFilters(account, peer) : [], [account, peer, readLegacy]);
  const legacy = useRelayHistory(relays, filters, onEvent);
  const a = legacy.status, b = gifts.status;
  const status = useMemo(() => {
    const byRelay: RelayStates = { ...a.byRelay };
    for (const [url, state] of Object.entries(b.byRelay)) {
      const old = byRelay[url];
      byRelay[url] = old === 'failed' || state === 'failed' ? 'failed' :
        old === 'checking' || state === 'checking' ? 'checking' : 'synced';
    }
    return { loading: a.loading || b.loading, hasOlder: a.hasOlder || b.hasOlder, failed: a.failed || b.failed,
      crowded: a.crowded || b.crowded, total: Object.keys(byRelay).length, byRelay };
  }, [a, b]);
  const retryLegacy = legacy.retry, retryGifts = gifts.retry;
  const retry = useCallback(() => { retryLegacy(); retryGifts(); }, [retryLegacy, retryGifts]);
  const loadOlder = () => { if (a.hasOlder) legacy.loadOlder(); if (b.hasOlder) gifts.loadOlder(); };
  return { status, primal, loadOlder, retry };
}
