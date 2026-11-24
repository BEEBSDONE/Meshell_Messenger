import React, { useState } from 'react';
import { normalizeRelayUrl, removeNsec, removeRelays, removePrivateKey, removeDarkMode } from '../utils/storage';
import styles from './SettingsPage.module.css';

interface SettingsPageProps {
  relayList: string[];
  onChange: (relays: string[]) => void;
  setShowSettings: (show: boolean) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ setShowSettings, relayList, onChange }) => {
  const [relayInput, setRelayInput] = useState('');
  const addRelay = () => {
    const relay = normalizeRelayUrl(relayInput);
    if (!relay) {
      alert('Enter a wss:// relay URL (or ws://localhost for a local relay).');
      return;
    }
    if (relayList.includes(relay)) {
      alert('Relay already exists in the list.');
      return;
    }
    const updatedRelays = [...relayList, relay];
    onChange(updatedRelays);
    setRelayInput('');
  };

  const removeRelay = (relay: string) => {
    const updatedRelays = relayList.filter((r) => r !== relay);
    onChange(updatedRelays);
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

