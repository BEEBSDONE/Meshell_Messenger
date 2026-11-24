import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools';
import useHistory from '../hooks/useHistory';
import useProfiles from '../hooks/useProfiles';
import { conversationPeer } from '../utils/history';
import { decodeNsec, encodeNpub, pool } from '../utils/nostr';
import { getNsec, getRelays, getDarkMode, setRelays } from '../utils/storage';
import ConversationList from './ConversationList';
import MessageList from './MessageList';
import styles from './ChatPage.module.css';

export interface Conversation {
  pubkey: string;
  name: string;
  picture?: string;
}

export default function ChatPage() {
  const [keys, setKeys] = useState<{ sk: Uint8Array; pk: string } | null>(null);
  const [keyError, setKeyError] = useState(false);
  const [relays, setRelayState] = useState(getRelays);
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(getDarkMode);
  const [mobile, setMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    let active = true;
    getNsec().then(nsec => {
      if (!active) return;
      if (!nsec) throw new Error();
      const sk = decodeNsec(nsec);
      setKeys({ sk, pk: getPublicKey(sk) });
    }).catch(() => { if (active) setKeyError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => pool.destroy(), [relays]);
  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 768);
    const storage = (e: StorageEvent) => { if (e.key === 'relays' || e.key === null) setRelayState(getRelays()); };
    window.addEventListener('resize', update);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('storage', storage);
    };
  }, []);
  useEffect(() => { document.body.classList.toggle('darkMode', darkMode); }, [darkMode]);

  const pk = keys?.pk || '';
  const receive = useCallback((event: NostrEvent) => {
    const peer = conversationPeer(event, pk);
    if (!peer) return;
    setLatest(prev => (prev[peer] ?? -1) >= event.created_at ? prev : { ...prev, [peer]: event.created_at });
  }, [pk]);
  const history = useHistory(relays, pk, undefined, receive);
  const peers = useMemo(() => Object.keys(latest).sort((a, b) => latest[b] - latest[a] || a.localeCompare(b)), [latest]);
  const profiles = useProfiles(relays, peers);
  const conversations = peers.map(pubkey => ({
    pubkey, name: profiles[pubkey]?.name || encodeNpub(pubkey), picture: profiles[pubkey]?.picture,
  }));
  const current = conversations.find(c => c.pubkey === selected);
  function select(pubkey: string) {
    setLatest(prev => pubkey in prev ? prev : { ...prev, [pubkey]: 0 });
    setSelected(pubkey);
  }
  function changeRelays(next: string[]) {
    setRelays(next);
    setRelayState(next);
  }

  if (keyError) return <p role="alert">Your account key could not be read. Reopen MeShell to try again.</p>;
  if (!keys) return <p role="status">Opening your inbox…</p>;
  const sidebar = <ConversationList {...{ conversations, history, darkMode, setDarkMode, relays }} onSelect={select} onRelaysChange={changeRelays} />;
  const thread = current && <MessageList key={current.pubkey} conversation={current} isDarkMode={darkMode}
    account={keys} relays={relays} onBack={mobile ? () => setSelected(null) : undefined} />;
  return (
    <div className={styles.chatPage}>
      {mobile ? (thread || sidebar) : <>
        <div className={styles.sidebar}>{sidebar}</div>
        <div className={styles.mainContent}>{thread || <div className={styles.noConversationSelected}>Select a conversation</div>}</div>
      </>}
    </div>
  );
}
