import { useCallback, useEffect, useMemo, useState } from 'react';
import { nsecEncode } from 'nostr-tools/nip19';
import type { Account } from '../utils/privateMessages';
import type { Event as NostrEvent } from 'nostr-tools';
import useInboxRelays from '../hooks/useInboxRelays';
import useDefaultInbox from '../hooks/useDefaultInbox';
import usePrivateInbox from '../hooks/usePrivateInbox';
import useHistory from '../hooks/useHistory';
import useRelaySettings from '../hooks/useRelaySettings';
import useProfiles from '../hooks/useProfiles';
import { PrimalHistory } from '../utils/primalHistory';
import { verifyEvent } from 'nostr-tools/pure';
import { MessageCache, initialCacheStatus } from '../utils/messageCache';
import { conversationPeer } from '../utils/history';
import { encodeNpub, pool } from '../utils/nostr';
import { getRelays, getDarkMode, setRelays, primalHistoryEnabled, setPrimalHistoryEnabled } from '../utils/storage';
import ConversationList from './ConversationList';
import MessageList from './MessageList';
import styles from './ChatPage.module.css';

export interface Conversation {
  pubkey: string;
  name: string;
  picture?: string;
}

export default function ChatPage({ keys, vaultId, justRegistered }: { keys: Account; vaultId: string; justRegistered: boolean }) {
  const [primalEnabled, setPrimalEnabled] = useState(() => primalHistoryEnabled(keys.pk));
  const [relays, setRelayState] = useState(getRelays);
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [legacyPeers, setLegacyPeers] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(getDarkMode);
  const [mobile, setMobile] = useState(window.innerWidth < 768);

  useEffect(() => () => pool.destroy(), [relays]);
  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 768);
    const storage = (e: StorageEvent) => {
      if (e.key === 'relays' || e.key === null) setRelayState(getRelays());
      if (keys && (e.key === 'primalHistory:' + keys.pk || e.key === null)) setPrimalEnabled(primalHistoryEnabled(keys.pk));
    };
    window.addEventListener('resize', update);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('storage', storage);
    };
  }, [keys]);
  useEffect(() => { document.body.classList.toggle('darkMode', darkMode); }, [darkMode]);

  const pk = keys.pk;
  const cache = useMemo(() => new MessageCache(keys, vaultId), [keys, vaultId]);
  const [cacheStatus, setCacheStatus] = useState(initialCacheStatus);
  const [cachedLegacy, setCachedLegacy] = useState<Record<string, Record<string, NostrEvent>>>({});
  const notePeer = useCallback((peer: string, time: number) => {
    setLatest(prev => (prev[peer] ?? -1) >= time ? prev : { ...prev, [peer]: time });
  }, []);
  const directory = useInboxRelays(keys, relays);
  const gifts = usePrivateInbox(keys, directory, notePeer, cache.remember);
  const receive = useCallback((event: NostrEvent) => {
    const peer = conversationPeer(event, pk);
    if (!peer || !verifyEvent(event)) return;
    cache.remember(event);
    setLegacyPeers(prev => prev.has(peer) ? prev : new Set(prev).add(peer));
    notePeer(peer, event.created_at);
  }, [pk, notePeer, cache]);
  const acceptGift = gifts.accept;
  useEffect(() => cache.start(events => {
    const legacy: Record<string, Record<string, NostrEvent>> = {};
    for (const event of events) {
      if (event.kind === 1059) { acceptGift(event); continue; }
      const peer = conversationPeer(event, pk);
      if (peer) { receive(event); (legacy[peer] ??= {})[event.id] = event; }
    }
    if (Object.keys(legacy).length) setCachedLegacy(previous => {
      const next = { ...previous };
      for (const [peer, rows] of Object.entries(legacy)) next[peer] = { ...previous[peer], ...rows };
      return next;
    });
  }, setCacheStatus), [cache, pk, receive, acceptGift]);
  const peers = useMemo(() => Object.keys(latest).sort((a, b) => latest[b] - latest[a] || a.localeCompare(b)), [latest]);
  const { profiles, acceptProfile } = useProfiles(relays, peers);
  const archive = useMemo(() => pk && primalEnabled ? new PrimalHistory(pk, acceptProfile) : null, [pk, primalEnabled, acceptProfile]);
  useEffect(() => () => archive?.close(), [archive]);
  const history = useHistory(relays, pk, undefined, receive, archive, gifts.history, directory.signAuth);
  const dmInbox = useDefaultInbox(directory, relays, history.status.byRelay, history.retry, justRegistered);
  const relaySettings = useRelaySettings(relays, pk, selected, history, receive, directory.signAuth);
  function retryRelays() {
    if (!directory.hasList) directory.refresh();
    relaySettings.retry();
  }
  function changePrimal(enabled: boolean) {
    if (!pk) return;
    setPrimalHistoryEnabled(pk, enabled);
    setPrimalEnabled(enabled);
  }
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

  const sidebar = <ConversationList account={keys} cacheStatus={cacheStatus} onCacheChange={enabled => cache.setEnabled(enabled)} dmInbox={dmInbox} giftHistory={gifts.history} {...{ conversations, history, darkMode, setDarkMode, relays }} onSelect={select} onRelaysChange={changeRelays}
    onCopyNsec={() => navigator.clipboard.writeText(nsecEncode(keys.sk))}
    relayStates={relaySettings.states} onRetryRelays={retryRelays} primalEnabled={primalEnabled} onPrimalChange={changePrimal} />;
  const thread = current && <MessageList key={current.pubkey} conversation={current} isDarkMode={darkMode}
    account={keys} cachedLegacy={cachedLegacy[current.pubkey]} rememberLegacy={cache.remember} relays={relays} archive={archive} hasLegacy={legacyPeers.has(current.pubkey)}
    dmInbox={dmInbox} giftHistory={gifts.history} privateMessages={gifts.threads[current.pubkey]} acceptWrap={gifts.accept} onRelayStatus={relaySettings.reportThread} onBack={mobile ? () => setSelected(null) : undefined} />;
  return (
    <div className={styles.chatPage}>
      {mobile ? (thread || sidebar) : <>
        <div className={styles.sidebar}>{sidebar}</div>
        <div className={styles.mainContent}>{thread || <div className={styles.noConversationSelected}>Select a conversation</div>}</div>
      </>}
    </div>
  );
}
