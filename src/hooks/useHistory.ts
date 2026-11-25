import { useEffect, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import { dmFilters, openHistory, type HistoryStatus } from '../utils/history';
import usePrimalHistory from './usePrimalHistory';
import type { PrimalHistory } from '../utils/primalHistory';
import { pool } from '../utils/nostr';

export default function useHistory(relays: string[], account: string, peer: string | undefined, onEvent: (event: Event) => void, archive: PrimalHistory | null) {
  const primal = usePrimalHistory(archive, peer, onEvent);
  const active = useRef<ReturnType<typeof openHistory> | null>(null);
  const [status, setStatus] = useState<HistoryStatus>({
    loading: true, hasOlder: false, failed: 0, total: relays.length, crowded: false,
  });
  useEffect(() => {
    if (!account) return;
    const history = openHistory(pool, relays, dmFilters(account, peer), onEvent, setStatus);
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
  }, [relays, account, peer, onEvent]);
  return { status, primal, loadOlder: () => active.current?.loadOlder(), retry: () => active.current?.retry() };
}
