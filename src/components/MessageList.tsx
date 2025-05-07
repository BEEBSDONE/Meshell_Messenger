import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify'; // Import DOMPurify
import { getNsec, getRelays } from '../utils/storage';
import { decodeNsec, createEvent, KIND_ENCRYPTED_DIRECT_MESSAGE } from '../utils/nostr';
import { getPublicKey } from 'nostr-tools/pure';
import { nip04, SimplePool } from 'nostr-tools';
import styles from './MessageList.module.css';
import ProfilePicture from './ProfilePicture';

interface Conversation {
  id: string;
  pubkey: string;
  name: string;
}

interface MessageWithContent {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  decryptedContent: string;
}

interface MessageListProps {
  conversation: Conversation;
  isDarkMode: boolean;
  onBack?: () => void; // Callback for the back button on mobile view
}

const MessageList: React.FC<MessageListProps> = ({ conversation, isDarkMode, onBack }) => {
  const [messages, setMessages] = useState<MessageWithContent[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [sk, setSk] = useState<Uint8Array | null>(null);
  const [pk, setPk] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isAutoScrollEnabled] = useState(true);

  const messageIdsRef = useRef<Set<string>>(new Set());
  const pool = useMemo(() => new SimplePool(), []);
  const relayUrls = useMemo(() => {
    const relaysFromStorage = getRelays();
    return Array.isArray(relaysFromStorage) ? relaysFromStorage : ['wss://relay.damus.io'];
  }, []);

  useEffect(() => {
    const initializeKeys = async () => {
      const nsec = await getNsec();
      if (nsec) {
        try {
          const privateKey = decodeNsec(nsec);
          const publicKey = getPublicKey(privateKey);
          setSk(privateKey);
          setPk(publicKey);
        } catch (error) {
          console.error('Error decoding nsec:', error);
        }
      }
    };
    initializeKeys();
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!sk || !pk) return;

    const filters = [
      { kinds: [KIND_ENCRYPTED_DIRECT_MESSAGE], authors: [pk], '#p': [conversation.pubkey] },
      { kinds: [KIND_ENCRYPTED_DIRECT_MESSAGE], authors: [conversation.pubkey], '#p': [pk] },
    ];

    const sub = pool.subscribeMany(relayUrls, filters, {
      onevent: async (event: any) => {
        if (messageIdsRef.current.has(event.id)) return;
        messageIdsRef.current.add(event.id);
        let decryptedContent = '';
        try {
          decryptedContent = await nip04.decrypt(sk, event.pubkey === pk ? conversation.pubkey : event.pubkey, event.content);
        } catch {
          return;
        }
        const eventWithDecryptedContent: MessageWithContent = { ...event, decryptedContent };
        setMessages((prevMessages) => {
          const updatedMessages = [...prevMessages, eventWithDecryptedContent];
          updatedMessages.sort((a, b) => a.created_at - b.created_at);
          return updatedMessages;
        });
      },
    });

    return sub;
  }, [sk, pk, conversation.pubkey, pool, relayUrls]);

  useEffect(() => {
    let subscription: any = null;
    
    const loadMessages = async () => {
      messageIdsRef.current.clear();
      setMessages([]);
      setHasMoreMessages(true);
      subscription = await fetchMessages();
    };

    loadMessages();

    // Cleanup function to close subscription when component unmounts or conversation changes
    return () => {
      if (subscription) {
        subscription.close();
      }
    };
  }, [conversation.pubkey, fetchMessages]);

  useEffect(() => {
    if (isAutoScrollEnabled) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAutoScrollEnabled]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop === 0 && hasMoreMessages) {
      fetchMessages().then((loadedMessages) => {
        if (!loadedMessages) {
          setHasMoreMessages(false);
          return;
        }
      });
    }
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || !sk || !pk) return;

    // Sanitize the input value
    const sanitizedInput = DOMPurify.sanitize(inputValue.trim());

    let encryptedContent = '';
    try {
      encryptedContent = await nip04.encrypt(sk, conversation.pubkey, sanitizedInput);
    } catch {
      return;
    }

    const eventTemplate = {
      kind: KIND_ENCRYPTED_DIRECT_MESSAGE,
      content: encryptedContent,
      tags: [['p', conversation.pubkey]],
    };
    const event = createEvent(sk, eventTemplate);
    await pool.publish(relayUrls, event);
    const eventWithDecryptedContent: MessageWithContent = { ...event, decryptedContent: sanitizedInput };
    setMessages((prevMessages) => {
      const updatedMessages = [...prevMessages, eventWithDecryptedContent];
      updatedMessages.sort((a, b) => a.created_at - b.created_at);
      return updatedMessages;
    });
    messageIdsRef.current.add(event.id);
    setInputValue('');
  };

  return (
    <div className={`${styles.messageListContainer} ${isDarkMode ? styles.darkMode : ''}`}>
      <div className={styles.header}>
        {onBack && (
          <button className={styles.backButton} onClick={onBack}>
            ←
          </button>
        )}
        <ProfilePicture pubkey={conversation.pubkey} isDarkMode={isDarkMode} />
        <span className={styles.username}>{conversation.name}</span>
      </div>

      <div className={styles.messageList} onScroll={handleScroll} ref={messagesEndRef}>
        {messages.slice().reverse().map((message, index, array) => {
          const messageDate = new Date(message.created_at * 1000);
          const prevMessageDate = index > 0 ? new Date(array[index - 1].created_at * 1000) : null;
          
          const showDateSeparator = !prevMessageDate || 
            messageDate.getDate() !== prevMessageDate.getDate() ||
            messageDate.getMonth() !== prevMessageDate.getMonth() ||
            messageDate.getFullYear() !== prevMessageDate.getFullYear();

          return (
            <React.Fragment key={message.id}>
              {showDateSeparator && (
                <div className={styles.dateSeparator}>
                  {messageDate.toLocaleDateString(undefined, { 
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </div>
              )}
              <div className={message.pubkey === pk ? styles.sentMessage : styles.receivedMessage}>
                <div className={styles.messageContent}>
                  {message.decryptedContent || '[Encrypted Message]'}
                </div>
                <div className={styles.messageTime}>
                  {messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className={styles.inputContainer}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type your message..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage();
          }}
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
};

export default MessageList;

