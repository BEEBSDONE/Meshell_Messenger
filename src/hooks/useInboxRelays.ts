import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareEvents, finalizeEvent, type Event } from 'nostr-tools/pure';
import { inboxUrls, MAX_INBOX_RELAYS, validInbox, watchInbox } from '../utils/inboxRelays';
import { publishConfirmed, type AuthSigner } from '../utils/nostr';
import type { Account } from '../utils/privateMessages';

export default function useInboxRelays(account: Account | null, configured: string[]) {
  const [event, setEvent] = useState<Event>();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const [lookup, setLookup] = useState<{ round: number; relays: string[]; checked: Set<string> }>();
  const latest = useRef<Event | undefined>(undefined);
  const pendingId = useRef('');
  const queue = useRef(Promise.resolve(false));
  const cacheKey = 'dmInbox:' + account?.pk;
  const accept = useCallback((candidate: Event) => {
    if (!account || !validInbox(candidate, account.pk) ||
        (latest.current && compareEvents(candidate, latest.current) >= 0)) return;
    latest.current = candidate;
    setEvent(candidate);
    try { localStorage.setItem(cacheKey, JSON.stringify(candidate)); } catch { /* Relays retain the signed list. */ }
  }, [account, cacheKey]);
  const readCache = useCallback(() => {
    try {
      const saved = localStorage.getItem(cacheKey);
      if (saved) accept(JSON.parse(saved));
    } catch { /* Ignore a malformed cached list. */ }
  }, [cacheKey, accept]);
  const refresh = useCallback(() => { setError(''); setRound(previous => previous + 1); }, []);
  const signAuth = useMemo<AuthSigner | undefined>(() => account ?
    async template => finalizeEvent(template, account.sk) : undefined, [account]);
  const urls = useMemo(() => inboxUrls(event, configured), [event, configured]);
  const readRelays = useMemo(() => urls.every(url => configured.includes(url)) ? configured :
    [...new Set([...configured, ...urls])], [configured, urls]);
  useEffect(() => {
    if (!account) return;
    readCache();
    const storage = (e: StorageEvent) => { if (e.key === cacheKey) readCache(); };
    const retry = () => { if (!latest.current) refresh(); };
    const visible = () => { if (!document.hidden) retry(); };
    window.addEventListener('storage', storage);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [account, cacheKey, readCache, refresh]);
  useEffect(() => {
    if (!account) return;
    return watchInbox(account.pk, readRelays, signAuth, candidate => {
      if (candidate.id !== pendingId.current) accept(candidate);
    }, checked => setLookup({ round, relays: readRelays, checked }), true);
  }, [account, readRelays, accept, signAuth, round]);
  const checked = lookup?.round === round && lookup.relays === readRelays ? lookup.checked : undefined;

  const publish = useCallback((relays: string[], automatic?: AbortSignal) => {
    async function run() {
      if (!account || !relays.length || relays.length > MAX_INBOX_RELAYS || automatic?.aborted) return false;
      const { sk } = account;
      async function write() {
        readCache();
        if (automatic?.aborted) return false;
        if (automatic && latest.current) return true;
        const next = finalizeEvent({ kind: 10050, tags: relays.map(url => ['relay', url]), content: '',
          created_at: Math.max(Math.floor(Date.now() / 1000), (latest.current?.created_at ?? 0) + 1) }, sk);
        pendingId.current = next.id;
        const destinations = automatic ? relays : [...new Set([...configured, ...urls, ...relays])];
        await publishConfirmed(destinations, next, signAuth);
        accept(next);
        return true;
      }
      setPublishing(true);
      setError('');
      try {
        return navigator.locks ? await navigator.locks.request(cacheKey, write) : await write();
      } catch {
        if (!automatic) setError('No relay confirmed your inbox list. Try again.');
        return false;
      } finally {
        pendingId.current = '';
        setPublishing(false);
      }
    }
    const result = queue.current.then(run);
    queue.current = result;
    return result;
  }, [account, cacheKey, readCache, configured, urls, signAuth, accept]);
  return { urls, readRelays, hasList: !!event, checked, publishing, error, publish, signAuth, refresh };
}
export type InboxDirectory = ReturnType<typeof useInboxRelays>;
