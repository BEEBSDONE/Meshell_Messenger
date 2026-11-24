import React, { useState } from 'react';
import * as nip19 from 'nostr-tools/nip19';
import styles from './NewConversationModal.module.css';

interface NewConversationModalProps {
  setShowNewConversationModal: (show: boolean) => void;
  onSelect: (pubkey: string) => void;
}

const NewConversationModal: React.FC<NewConversationModalProps> = ({ setShowNewConversationModal, onSelect }) => {
  const [npubInput, setNpubInput] = useState('');
  const addConversation = () => {
    try {
      const { type, data } = nip19.decode(npubInput.trim());
      if (type !== 'npub') throw new Error();
      onSelect(data);
      setShowNewConversationModal(false);
    } catch {
      alert('Please enter a valid npub.');
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

