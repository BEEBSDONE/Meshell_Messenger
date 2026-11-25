import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareEvents, finalizeEvent, type Event } from 'nostr-tools/pure';
import { inboxUrls, validInbox, watchInbox } from '../utils/inboxRelays';
import { publishConfirmed, type AuthSigner } from '../utils/nostr';
import type { Account } from '../utils/privateMessages';

export default function useInboxRelays(account: Account | null, configured: string[]) {
  const [event, setEvent] = useState<Event>();
  const [looking, setLooking] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const latest = useRef<Event | undefined>(undefined);
  const accept = useCallback((candidate: Event) => {
    if (!account || !validInbox(candidate, account.pk) ||
        (latest.current && compareEvents(candidate, latest.current) >= 0)) return;
    latest.current = candidate;
    setEvent(candidate);
    try { localStorage.setItem('dmInbox:' + account.pk, JSON.stringify(candidate)); } catch { /* Relays retain the signed list. */ }
  }, [account]);
  const signAuth = useMemo<AuthSigner | undefined>(() => account ?
    async template => finalizeEvent(template, account.sk) : undefined, [account]);
  const urls = useMemo(() => inboxUrls(event, configured), [event, configured]);
  const readRelays = useMemo(() => [...new Set([...configured, ...urls])], [configured, urls]);
  useEffect(() => {
    if (!account) return;
    try {
      const saved = localStorage.getItem('dmInbox:' + account.pk);
      if (saved) accept(JSON.parse(saved));
    } catch { /* Ignore a malformed cached list. */ }
    setLooking(true);
    return watchInbox(account.pk, readRelays, signAuth, accept, () => setLooking(false), true);
  }, [account, readRelays, accept, signAuth]);
  async function publish(relays: string[]) {
    if (!account || !relays.length || relays.length > 16 || inFlight.current) return false;
    inFlight.current = true; setPublishing(true); setError('');
    try {
      const next = finalizeEvent({ kind: 10050, tags: relays.map(url => ['relay', url]), content: '',
        created_at: Math.max(Math.floor(Date.now() / 1000), (latest.current?.created_at ?? 0) + 1) }, account.sk);
      await publishConfirmed([...new Set([...configured, ...urls, ...relays])], next, signAuth);
      accept(next);
      return true;
    } catch { setError('No relay confirmed your inbox list. Try again.'); return false; }
    finally { inFlight.current = false; setPublishing(false); }
  }
  return { urls, readRelays, looking, publishing, error, publish, signAuth };
}
export type InboxRelays = ReturnType<typeof useInboxRelays>;
