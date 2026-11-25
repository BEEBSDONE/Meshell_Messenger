import { useEffect, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import type { ArchiveCursor, PrimalHistory } from '../utils/primalHistory';

type State = 'off' | 'loading' | 'more' | 'done' | 'empty' | 'error';

export default function usePrimalHistory(archive: PrimalHistory | null, peer: string | undefined, onEvent: (event: Event) => void) {
  const [state, setState] = useState<State>('off');
  const next = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!archive) { setState('off'); return; }
    const controller = new AbortController();
    const { signal } = controller;
    let cursor: ArchiveCursor | null = { until: Math.floor(Date.now() / 1000), offset: 0 };
    let busy = false;
    let failed = false;
    let found = false;
    const receive = (event: Event) => { found = true; onEvent(event); };
    const seed = peer && archive.latestMessage(peer);
    if (seed) receive(seed);
    const load = async () => {
      if (busy || !cursor || signal.aborted) return;
      busy = true;
      failed = false;
      setState('loading');
      try {
        cursor = await archive.page(peer, cursor, signal, receive);
        if (!signal.aborted) setState(cursor ? 'more' : found ? 'done' : 'empty');
      } catch {
        if (!signal.aborted) { failed = true; setState('error'); }
      } finally { busy = false; }
    };
    const retry = () => { if (failed) void load(); };
    window.addEventListener('online', retry);
    next.current = load;
    void load();
    return () => {
      controller.abort();
      next.current = undefined;
      window.removeEventListener('online', retry);
    };
  }, [archive, peer, onEvent]);
  return { state, next: () => next.current?.() };
}
