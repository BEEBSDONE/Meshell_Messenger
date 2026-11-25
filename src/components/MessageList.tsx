import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import useSendMessage from '../hooks/useSendMessage';
import type { InboxRelays } from '../hooks/useInboxRelays';
import type { Rumor } from '../utils/privateMessages';
import useHistory, { type RelayHistory } from '../hooks/useHistory';
import type { ThreadRelayStatus } from '../hooks/useRelaySettings';
import type { PrimalHistory } from '../utils/primalHistory';
import { conversationPeer } from '../utils/history';
import type { Conversation } from './ChatPage';
import HistoryControls from './HistoryControls';
import ProfilePicture from './ProfilePicture';
import styles from './MessageList.module.css';

interface Props {
  archive: PrimalHistory | null;
  hasLegacy: boolean;
  dmInbox: InboxRelays;
  giftHistory: RelayHistory;
  privateMessages?: Record<string, Rumor>;
  acceptWrap: (event: Event) => void;
  account: { sk: Uint8Array; pk: string };
  conversation: Conversation;
  relays: string[];
  isDarkMode: boolean;
  onRelayStatus: (status: ThreadRelayStatus) => void;
  onBack?: () => void;
}

interface Message {
  id: string;
  sent: boolean;
  time: number;
  text: string | null;
}

export default function MessageList({ account, conversation, relays, archive, hasLegacy, dmInbox, giftHistory, privateMessages, acceptWrap, isDarkMode, onBack, onRelayStatus }: Props) {
  const { pk, sk } = account;
  const peer = conversation.pubkey;
  const [byId, setById] = useState<Record<string, Message>>({});
  const [searchLegacy, setSearchLegacy] = useState(false);
  const readLegacy = hasLegacy || searchLegacy;
  const composer = useSendMessage(account, peer, relays, dmInbox, acceptWrap);
  const active = useRef(true);
  const scrollBox = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const store = useCallback((event: Event, text: string | null) => {
    if (!active.current) return;
    const message = { id: event.id, sent: event.pubkey === pk, time: event.created_at, text };
    setById(prev => prev[event.id] ? prev : { ...prev, [event.id]: message });
  }, [pk]);
  const decryptedIds = useRef(new Set<string>());
  const receive = useCallback(async (event: Event) => {
    if (conversationPeer(event, pk) !== peer || decryptedIds.current.has(event.id)) return;
    decryptedIds.current.add(event.id);
    try {
      store(event, await nip04.decrypt(sk, peer, event.content));
    } catch {
      store(event, null);
    }
  }, [peer, pk, sk, store]);
  const history = useHistory(relays, pk, peer, receive, readLegacy ? archive : null, giftHistory, readLegacy);
  const { byRelay } = history.status;
  const { retry } = history;
  useEffect(() => {
    onRelayStatus({ peer, relays, byRelay, retry });
  }, [peer, relays, byRelay, retry, onRelayStatus]);
  const messages = useMemo(() => {
    const modern = Object.values(privateMessages ?? {}).map(rumor => ({
      id: rumor.id, sent: rumor.pubkey === pk, time: rumor.created_at, text: rumor.content,
    }));
    return [...Object.values(byId), ...modern].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }, [byId, privateMessages, pk]);

  useLayoutEffect(() => {
    const box = scrollBox.current;
    if (box && followLatest.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  return (
    <div className={`${styles.messageListContainer} ${isDarkMode ? styles.darkMode : ''}`}>
      <div className={styles.header}>
        {onBack && <button className={styles.backButton} onClick={onBack} aria-label="Back to conversations">←</button>}
        <ProfilePicture picture={conversation.picture} isDarkMode={isDarkMode} />
        <span className={styles.username}>{conversation.name}</span>
      </div>
      <div role="region" aria-label="Messages" className={styles.messageList} ref={scrollBox} onScroll={e => {
        const box = e.currentTarget;
        followLatest.current = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
      }}>
        {!readLegacy && <button className={styles.legacyLookup} onClick={() => setSearchLegacy(true)}>Look for legacy messages</button>}
        <HistoryControls history={history} items="messages" empty={!messages.length} />
        {messages.map((message, i) => {
          const date = new Date(message.time * 1000);
          const newDay = !i || date.toDateString() !== new Date(messages[i - 1].time * 1000).toDateString();
          return (
            <Fragment key={message.id}>
              {newDay && <div className={styles.dateSeparator}>{date.toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}</div>}
              <div className={message.sent ? styles.sentMessage : styles.receivedMessage}>
                <div className={styles.messageContent}>{message.text ?? 'This message could not be decrypted.'}</div>
                <div className={styles.messageTime}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {composer.error && <div role="alert" className={styles.sendNotice}>{composer.error}
        {composer.draft && !composer.draft.delivered && !composer.busy && <button onClick={composer.discard}>Edit draft</button>}
      </div>}
      <form className={styles.inputContainer} onSubmit={e => { e.preventDefault(); followLatest.current = true; void composer.send(); }}>
        <input aria-label="Message" value={composer.text} disabled={composer.busy || composer.restoring} readOnly={!!composer.draft}
          onChange={e => composer.setText(e.target.value)} placeholder="Type your message..." />
        <button disabled={composer.busy || composer.restoring || !composer.text.trim()}>{composer.busy ? 'Sending…' : composer.draft ? 'Retry' : 'Send'}</button>
      </form>
    </div>
  );
}
