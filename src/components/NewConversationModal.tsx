import React, { useState } from 'react';
import DOMPurify from 'dompurify'; // Import DOMPurify for sanitization
import * as nip19 from 'nostr-tools/nip19';
import styles from './NewConversationModal.module.css';
import { SimplePool } from 'nostr-tools/pool';
import { getRelays } from '../utils/storage';

interface Conversation {
  id: string;
  pubkey: string;
  name: string;
  latestMessageTimestamp: number;
}

interface NewConversationModalProps {
  setShowNewConversationModal: (show: boolean) => void;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  setCurrentConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  conversations: Conversation[];
}

const NewConversationModal: React.FC<NewConversationModalProps> = ({
  setShowNewConversationModal,
  setConversations,
  setCurrentConversation,
  conversations,
}) => {
  const [npubInput, setNpubInput] = useState('');

  const fetchProfileData = async (pubkey: string): Promise<string> => {
    try {
      const pool = new SimplePool();
      const relays = getRelays();

      const events = await pool.get(relays, {
        authors: [pubkey],
        kinds: [0],
      });

      if (events?.content) {
        const content = JSON.parse(events.content);
        return content.name || pubkey;
      }

      return pubkey;
    } catch (error) {
      console.error('Failed to fetch profile data:', error);
      return pubkey; // Use pubkey if fetching fails
    }
  };

  const addConversation = async () => {
    // Sanitize the npub input
    const npub = DOMPurify.sanitize(npubInput.trim());
    if (!npub) return;

    try {
      const { type, data } = nip19.decode(npub);
      if (type !== 'npub') {
        throw new Error('Invalid npub format');
      }
      const pubkey = data as string;

      // Check if the conversation already exists
      const existingConversation = conversations.find(convo => convo.pubkey === pubkey);
      if (existingConversation) {
        setCurrentConversation(existingConversation);
        setShowNewConversationModal(false);
        return;
      }

      // Fetch the user's profile name
      const name = await fetchProfileData(pubkey);

      // Add the new conversation with the fetched name
      const newConversation = { id: pubkey, pubkey, name, latestMessageTimestamp: 0 };
      setConversations((prevConversations) => [
        newConversation,
        ...prevConversations,
      ]);
      setCurrentConversation(newConversation);

      // Reset input and close modal
      setNpubInput('');
      setShowNewConversationModal(false);
    } catch (error) {
      console.error('Invalid npub:', error);
      alert('Invalid npub. Please enter a valid npub.');
    }
  };

  return (
    <div className={styles.modal}>
      <div className={styles.modalContent}>
        <h3>Start New Conversation</h3>
        <input
          type="text"
          value={npubInput}
          onChange={(e) => setNpubInput(e.target.value)}
          placeholder="Enter recipient's npub"
        />
        <div className={styles.modalActions}>
          <button className={styles.add} onClick={addConversation}>Add</button>
          <button className={styles.cancel} onClick={() => setShowNewConversationModal(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default NewConversationModal;

