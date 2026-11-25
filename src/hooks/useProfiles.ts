import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import type { SubCloser } from 'nostr-tools/pool';
import { pool } from '../utils/nostr';

interface Profile {
  name?: string;
  picture?: string;
  createdAt: number;
  id: string;
}

export default function useProfiles(relays: string[], peers: string[]) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const acceptProfile = useCallback((event: Event) => {
    let data;
    try { data = JSON.parse(event.content); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const name = typeof data.name === 'string' ? data.name.trim() : undefined;
    const picture = typeof data.picture === 'string' && /^https:\/\//i.test(data.picture) ? data.picture : undefined;
    setProfiles(prev => {
      const old = prev[event.pubkey];
      if (old && (old.createdAt > event.created_at || (old.createdAt === event.created_at && old.id <= event.id))) return prev;
      return { ...prev, [event.pubkey]: { name, picture, createdAt: event.created_at, id: event.id } };
    });
  }, []);
  const session = useMemo(() => ({ relays, active: true, requested: new Set<string>(), subs: new Set<SubCloser>() }), [relays]);
  const peerList = peers.join(',');
  useEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
      session.subs.forEach(sub => sub.close());
      session.subs.clear();
      session.requested.clear();
    };
  }, [session]);
  useEffect(() => {
    if (!peerList || !session.relays.length) return;
    const timer = setTimeout(() => {
      const missing = peerList.split(',').filter(pk => !session.requested.has(pk));
      for (let i = 0; i < missing.length; i += 50) {
        const authors = missing.slice(i, i + 50);
        authors.forEach(pk => session.requested.add(pk));
        const sub = pool.subscribeEose(session.relays, { kinds: [0], authors }, {
          maxWait: 8_000,
          onevent(event) { if (session.active) acceptProfile(event); },
          onclose: () => session.subs.delete(sub),
        });
        session.subs.add(sub);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [peerList, session, acceptProfile]);
  return { profiles, acceptProfile };
}
