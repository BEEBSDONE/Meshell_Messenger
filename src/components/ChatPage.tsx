import { useCallback, useEffect, useMemo, useState } from 'react';
import { nsecEncode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools';
import useInboxRelays from '../hooks/useInboxRelays';
import usePrivateInbox from '../hooks/usePrivateInbox';
import useHistory from '../hooks/useHistory';
import useRelaySettings from '../hooks/useRelaySettings';
import useProfiles from '../hooks/useProfiles';
import { PrimalHistory } from '../utils/primalHistory';
import { conversationPeer } from '../utils/history';
import { decodeNsec, encodeNpub, pool } from '../utils/nostr';
import { ACCOUNT_CHANGE, getNsec, getRelays, getDarkMode, setRelays, primalHistoryEnabled, setPrimalHistoryEnabled } from '../utils/storage';
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
  const [primalEnabled, setPrimalEnabled] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [relays, setRelayState] = useState(getRelays);
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [legacyPeers, setLegacyPeers] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(getDarkMode);
  const [mobile, setMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    let active = true;
    getNsec().then(nsec => {
      if (!active) return;
      if (!nsec) throw new Error();
      const sk = decodeNsec(nsec);
      const pk = getPublicKey(sk);
      setPrimalEnabled(primalHistoryEnabled(pk));
      setKeys({ sk, pk });
    }).catch(() => { if (active) setKeyError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => pool.destroy(), [relays]);
  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 768);
    const storage = (e: StorageEvent) => {
      if (e.key === ACCOUNT_CHANGE) { window.location.replace('/'); return; }
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

  const pk = keys?.pk || '';
  const notePeer = useCallback((peer: string, time: number) => {
    setLatest(prev => (prev[peer] ?? -1) >= time ? prev : { ...prev, [peer]: time });
  }, []);
  const dmInbox = useInboxRelays(keys, relays);
  const gifts = usePrivateInbox(keys, dmInbox, notePeer);
  const receive = useCallback((event: NostrEvent) => {
    const peer = conversationPeer(event, pk);
    if (!peer) return;
    setLegacyPeers(prev => prev.has(peer) ? prev : new Set(prev).add(peer));
    notePeer(peer, event.created_at);
  }, [pk, notePeer]);
  const peers = useMemo(() => Object.keys(latest).sort((a, b) => latest[b] - latest[a] || a.localeCompare(b)), [latest]);
  const { profiles, acceptProfile } = useProfiles(relays, peers);
  const archive = useMemo(() => pk && primalEnabled ? new PrimalHistory(pk, acceptProfile) : null, [pk, primalEnabled, acceptProfile]);
  useEffect(() => () => archive?.close(), [archive]);
  const history = useHistory(relays, pk, undefined, receive, archive, gifts.history);
  const relaySettings = useRelaySettings(relays, pk, selected, history, receive);
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

  if (keyError) return <p role="alert">Your account key could not be read. Reopen MeShell to try again.</p>;
  if (!keys) return <p role="status">Opening your inbox…</p>;
  const sidebar = <ConversationList dmInbox={dmInbox} giftHistory={gifts.history} {...{ conversations, history, darkMode, setDarkMode, relays }} onSelect={select} onRelaysChange={changeRelays}
    onCopyNsec={() => navigator.clipboard.writeText(nsecEncode(keys.sk))}
    relayStates={relaySettings.states} onRetryRelays={relaySettings.retry} primalEnabled={primalEnabled} onPrimalChange={changePrimal} />;
  const thread = current && <MessageList key={current.pubkey} conversation={current} isDarkMode={darkMode}
    account={keys} relays={relays} archive={archive} hasLegacy={legacyPeers.has(current.pubkey)}
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
