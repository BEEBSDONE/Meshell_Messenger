import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import useHistory from '../hooks/useHistory';
import { conversationPeer } from '../utils/history';
import { createEvent, KIND_ENCRYPTED_DIRECT_MESSAGE, publishConfirmed } from '../utils/nostr';
import type { Conversation } from './ChatPage';
import HistoryControls from './HistoryControls';
import ProfilePicture from './ProfilePicture';
import styles from './MessageList.module.css';

interface Props {
  account: { sk: Uint8Array; pk: string };
  conversation: Conversation;
  relays: string[];
  isDarkMode: boolean;
  onBack?: () => void;
}

interface Message {
  id: string;
  sent: boolean;
  time: number;
  text: string | null;
}

export default function MessageList({ account, conversation, relays, isDarkMode, onBack }: Props) {
  const { pk, sk } = account;
  const peer = conversation.pubkey;
  const [byId, setById] = useState<Record<string, Message>>({});
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const draft = useRef<{ text: string; event: Event } | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
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
  const receive = useCallback(async (event: Event) => {
    if (conversationPeer(event, pk) !== peer) return;
    try {
      store(event, await nip04.decrypt(sk, peer, event.content));
    } catch {
      store(event, null);
    }
  }, [peer, pk, sk, store]);
  const history = useHistory(relays, pk, peer, receive);
  const messages = useMemo(() => Object.values(byId).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)), [byId]);

  useLayoutEffect(() => {
    const box = scrollBox.current;
    if (box && followLatest.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  async function sendMessage() {
    const text = inputValue.trim();
    if (!text || pending.current) return;
    pending.current = true;
    setSending(true);
    setSendError(false);
    try {
      if (!draft.current || draft.current.text !== text) {
        const content = await nip04.encrypt(sk, peer, text);
        if (!active.current) return;
        draft.current = { text, event: createEvent(sk, {
          kind: KIND_ENCRYPTED_DIRECT_MESSAGE, tags: [['p', peer]], content,
        }) };
      }
      const { event } = draft.current;
      await publishConfirmed(relays, event);
      if (!active.current) return;
      followLatest.current = true;
      store(event, text);
      draft.current = null;
      setInputValue('');
    } catch {
      if (active.current) setSendError(true);
    } finally {
      pending.current = false;
      if (active.current) setSending(false);
    }
  }

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
      {sendError && <div role="alert">No relay confirmed this message. Your draft is ready to retry.</div>}
      <form className={styles.inputContainer} onSubmit={e => { e.preventDefault(); void sendMessage(); }}>
        <input aria-label="Message" value={inputValue} disabled={sending} onChange={e => setInputValue(e.target.value)} placeholder="Type your message..." />
        <button disabled={sending || !inputValue.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
    </div>
  );
}
