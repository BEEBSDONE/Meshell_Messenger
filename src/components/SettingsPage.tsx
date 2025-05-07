import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify'; // Import DOMPurify
import { getRelays, setRelays, removeNsec, removeRelays, removePrivateKey, removeDarkMode } from '../utils/storage';
import styles from './SettingsPage.module.css';

interface SettingsPageProps {
  setShowSettings: (show: boolean) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ setShowSettings }) => {
  const [relayInput, setRelayInput] = useState('');
  const [relayList, setRelayList] = useState<string[]>([]);

  useEffect(() => {
    const relays = getRelays();
    setRelayList(relays);
  }, []);

  const addRelay = () => {
    const relay = DOMPurify.sanitize(relayInput.trim()); // Sanitize the relay input
    if (!relay) {
      alert('Please enter a relay URL.');
      return;
    }
    if (relayList.includes(relay)) {
      alert('Relay already exists in the list.');
      return;
    }
    const updatedRelays = [...relayList, relay];
    setRelayList(updatedRelays);
    setRelays(updatedRelays);
    setRelayInput('');
  };

  const removeRelay = (relay: string) => {
    const updatedRelays = relayList.filter((r) => r !== relay);
    setRelayList(updatedRelays);
    setRelays(updatedRelays);
  };

  const logout = async () => {
    await removeNsec();
    removeDarkMode();
    removePrivateKey();
    removeRelays();
    window.location.href = '/';
  };

  return (
    <div className={styles.settingsPage}>
      <div className={styles.relaySection}>
        <h3>Relays</h3>
        <ul className={styles.relayList}>
          {relayList.map((relay) => (
            <li key={relay} className={styles.relayItem}>
              <span>{relay}</span>
              <button onClick={() => removeRelay(relay)}>Remove</button>
            </li>
          ))}
        </ul>
        <input
          type="text"
          className={styles.inputField}
          value={relayInput}
          onChange={(e) => setRelayInput(e.target.value)}
          placeholder="Enter relay URL"
        />
        <button className={styles.addRelayButton} onClick={addRelay}>
          Add Relay
        </button>
        <button className={styles.logout} onClick={logout}>
          Logout
        </button>
        <button className={styles.close} onClick={() => setShowSettings(false)}>
          Close
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;

