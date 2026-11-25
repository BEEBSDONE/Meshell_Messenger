import { useEffect, useState } from 'react';
import type { Event } from 'nostr-tools';
import { dmFilters, openHistory, type RelayStates } from '../utils/history';
import { pool } from '../utils/nostr';
import type useHistory from './useHistory';

export interface ThreadRelayStatus {
  peer: string;
  relays: string[];
  byRelay: RelayStates;
  retry: () => void;
}

export default function useRelaySettings(
  relays: string[], account: string, selected: string | null, inbox: ReturnType<typeof useHistory>,
  onEvent: (event: Event) => void,
) {
  const [thread, reportThread] = useState<ThreadRelayStatus | null>(null);
  const [check, setCheck] = useState<{ peer: string; relays: string[]; urls: string[] } | null>(null);
  const recent = thread?.relays === relays ? thread : null;
  const active = recent?.peer === selected ? recent : null;

  // On mobile the thread unmounts before Settings opens. When retried,
  // recheck its actual filters and close the temporary subscriptions at EOSE.
  useEffect(() => {
    if (!check) return;
    if (selected || check.relays !== relays) { setCheck(null); return; }
    const history = openHistory(pool, check.urls, dmFilters(account, check.peer), onEvent, status => {
      if (status.loading) return;
      reportThread(last => last?.peer === check.peer && last.relays === relays
        ? { ...last, byRelay: { ...last.byRelay, ...status.byRelay } } : last);
      setCheck(null);
    });
    return () => history.close();
  }, [check, selected, relays, account, onEvent]);

  const states: RelayStates = {};
  for (const url of relays) {
    const inboxState = inbox.status.byRelay[url] ?? 'checking';
    let threadState = selected ? (active?.byRelay[url] ?? inboxState) : undefined;
    if (!selected && recent?.byRelay[url] === 'failed') {
      threadState = check?.urls.includes(url) ? 'checking' : 'failed';
    }
    if (inboxState === 'failed' || threadState === 'failed') states[url] = 'failed';
    else if (inboxState === 'checking' || threadState === 'checking') states[url] = 'checking';
    else states[url] = 'synced';
  }

  function retry() {
    inbox.retry();
    if (active) active.retry();
    else if (!selected && recent && !check) {
      const urls = relays.filter(url => recent.byRelay[url] === 'failed');
      if (urls.length) setCheck({ peer: recent.peer, relays, urls });
    }
  }

  return { states, retry, reportThread };
}
