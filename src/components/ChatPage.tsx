import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ConversationList from './ConversationList';
import MessageList from './MessageList';
import SettingsPage from './SettingsPage';
import NewConversationModal from './NewConversationModal';
import { getNsec, getRelays, getDarkMode, setRelays } from '../utils/storage';
import { decodeNsec, pool, KIND_ENCRYPTED_DIRECT_MESSAGE, KIND_METADATA } from '../utils/nostr';
import { getPublicKey } from 'nostr-tools';
import styles from './ChatPage.module.css';

interface Conversation {
  id: string;
  pubkey: string;
  name: string;
  latestMessageTimestamp: number;
}

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [darkMode, setDarkModeState] = useState<boolean>(getDarkMode() || false);
  const [isMobileView, setIsMobileView] = useState<boolean>(window.innerWidth < 768);

  const conversationsRef = useRef<Map<string, Conversation>>(new Map());
  const fetchedMetadataPubkeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const initializeChat = async () => {
      const nsec = await getNsec();
      if (!nsec) {
        navigate('/'); // Redirect to login if nsec is not found
        return;
      }

      try {
        const sk = decodeNsec(nsec);
        const pk = getPublicKey(sk);

        // Check for relays in local storage and set default relays if none exist
        let relayUrls = getRelays();
        if (!relayUrls || !Array.isArray(relayUrls) || relayUrls.length === 0) {
          relayUrls = [
            'wss://relay.damus.io',
            'wss://nostr-pub.wellorder.net',
            'wss://relay.nostr.band',
            'wss://relay.snort.social',
          ];
          setRelays(relayUrls); // Save default relays to local storage
        }

        const filters = [
          { kinds: [KIND_ENCRYPTED_DIRECT_MESSAGE], '#p': [pk] },
          { kinds: [KIND_ENCRYPTED_DIRECT_MESSAGE], authors: [pk] },
        ];

        pool.subscribeMany(relayUrls, filters, {
          onevent: (event) => {
            const senderPubkey = event.pubkey;
            const recipientPubkey = event.tags.find((tag) => tag[0] === 'p')?.[1];
            const conversationPubkey = senderPubkey === pk ? recipientPubkey : senderPubkey;
            if (!conversationPubkey) return;

            const existingConversation = conversationsRef.current.get(conversationPubkey);
            const latestTimestamp = event.created_at;

            if (existingConversation) {
              existingConversation.latestMessageTimestamp = latestTimestamp;
              setConversations(
                Array.from(conversationsRef.current.values()).sort(
                  (a, b) => b.latestMessageTimestamp - a.latestMessageTimestamp
                )
              );
            } else if (!fetchedMetadataPubkeys.current.has(conversationPubkey)) {
              fetchedMetadataPubkeys.current.add(conversationPubkey);

              pool.subscribeMany(relayUrls, [
                { kinds: [KIND_METADATA], authors: [conversationPubkey] },
              ], {
                onevent: (metadataEvent) => {
                  try {
                    const metadata = JSON.parse(metadataEvent.content);
                    const name = metadata.name || conversationPubkey;

                    const newConversation: Conversation = {
                      id: conversationPubkey,
                      pubkey: conversationPubkey,
                      name,
                      latestMessageTimestamp: latestTimestamp,
                    };

                    conversationsRef.current.set(conversationPubkey, newConversation);
                    setConversations(
                      Array.from(conversationsRef.current.values()).sort(
                        (a, b) => b.latestMessageTimestamp - a.latestMessageTimestamp
                      )
                    );
                  } catch (error) {
                    console.error('Error parsing metadata:', error);
                  }
                },
              });
            }
          },
        });
      } catch (error) {
        console.error('Error initializing chat:', error);
        navigate('/');
      }
    };

    initializeChat();
  }, [navigate]);

  // Sync dark mode across the app
  useEffect(() => {
    document.body.classList.toggle('darkMode', darkMode);
  }, [darkMode]);

  // Monitor window width to switch between mobile and desktop view
  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`${styles.chatPage} ${darkMode ? 'darkMode' : ''}`}>
      {isMobileView ? (
        <>
          {!currentConversation ? (
            <ConversationList
              conversations={conversations}
              setConversations={setConversations}
              setCurrentConversation={setCurrentConversation}
              darkMode={darkMode}
              setDarkMode={setDarkModeState}
            />
          ) : (
            <MessageList
              conversation={currentConversation}
              isDarkMode={darkMode}
              onBack={() => setCurrentConversation(null)} // Add back functionality
            />
          )}
        </>
      ) : (
        <>
          <div className={styles.sidebar}>
            <ConversationList
              conversations={conversations}
              setConversations={setConversations}
              setCurrentConversation={setCurrentConversation}
              darkMode={darkMode}
              setDarkMode={setDarkModeState}
            />
          </div>
          <div className={styles.mainContent}>
            {currentConversation ? (
              <MessageList conversation={currentConversation} isDarkMode={darkMode} />
            ) : (
              <div className={styles.noConversationSelected}>Select a conversation</div>
            )}
          </div>
        </>
      )}

      {showNewConversationModal && (
        <NewConversationModal
          setShowNewConversationModal={setShowNewConversationModal}
          setConversations={setConversations}
          setCurrentConversation={setCurrentConversation}
          conversations={conversations}
        />
      )}

      {showSettings && <SettingsPage setShowSettings={setShowSettings} />}
    </div>
  );
};

export default ChatPage;

