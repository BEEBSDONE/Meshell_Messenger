import React, { useState } from 'react';
import { normalizeRelayUrl, removeNsec, removeRelays, removePrivateKey, removeDarkMode } from '../utils/storage';
import type { RelayStates, RelaySyncState } from '../utils/history';
import styles from './SettingsPage.module.css';

const syncLabels: Record<RelaySyncState, string> = { synced: 'Synced', failed: 'Not synced', checking: 'Checking' };

interface SettingsPageProps {
  primalEnabled: boolean;
  onPrimalChange: (enabled: boolean) => void;
  relayList: string[];
  relayStates: RelayStates;
  onRetryRelays: () => void;
  onChange: (relays: string[]) => void;
  setShowSettings: (show: boolean) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ setShowSettings, relayList, relayStates, onRetryRelays, onChange, primalEnabled, onPrimalChange }) => {
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
      <div className={styles.relaySection} role="dialog" aria-modal="true" aria-label="Settings">
        <h3>Relays</h3>
        {relayList.length > 0 && <div className={styles.legend}>
          {Object.entries(syncLabels).map(([state, label]) =>
            <span key={state}><i className={styles.dot} data-state={state} aria-hidden="true" />{label}</span>)}
        </div>}
        <ul className={styles.relayList}>
          {relayList.map(relay => {
            const state = relayStates[relay] ?? 'checking';
            return <li key={relay} className={styles.relayItem}>
              <span className={styles.relayAddress}>{relay}</span>
              <button onClick={() => removeRelay(relay)}>Remove</button>
              <span className={styles.dot} data-state={state} role="img" aria-label={syncLabels[state]} title={syncLabels[state]} />
            </li>;
          })}
        </ul>
        {Object.values(relayStates).includes('failed') && <button className={styles.retry} onClick={onRetryRelays}>Retry sync</button>}
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
        <label>
          <input type="checkbox" checked={primalEnabled} onChange={e => onPrimalChange(e.target.checked)} />
          Read history from Primal
        </label>
        <small>Primal receives your public key and your conversation partners’ public keys.</small>
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

