import React, { useRef, useState } from 'react';
import { normalizeRelayUrl, removeNsec, removeRelays, removePrivateKey, removeDarkMode } from '../utils/storage';
import MessageInboxSettings from './MessageInboxSettings';
import type { RelayHistory } from '../hooks/useHistory';
import type { InboxRelays } from '../hooks/useDefaultInbox';
import type { RelayStates, RelaySyncState } from '../utils/history';
import styles from './SettingsPage.module.css';

const syncLabels: Record<RelaySyncState, string> = { synced: 'Synced', failed: 'Not synced', checking: 'Checking' };

interface SettingsPageProps {
  dmInbox: InboxRelays;
  giftHistory: RelayHistory;
  onCopyNsec: () => Promise<void>;
  primalEnabled: boolean;
  onPrimalChange: (enabled: boolean) => void;
  relayList: string[];
  relayStates: RelayStates;
  onRetryRelays: () => void;
  onChange: (relays: string[]) => void;
  setShowSettings: (show: boolean) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ dmInbox, giftHistory, onCopyNsec, setShowSettings, relayList, relayStates, onRetryRelays, onChange, primalEnabled, onPrimalChange }) => {
  const [relayInput, setRelayInput] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  async function copyNsec() {
    try {
      await onCopyNsec();
      setNotice('nsec copied. Save it somewhere private before you log out.');
    } catch {
      setNotice('Copy failed. Allow clipboard access and try again.');
    }
  }
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
    if (leaving) return;
    setLeaving(true);
    try {
      await removeNsec();
    } catch {
      setLeaving(false);
      setNotice('Logout could not finish. Please try again.');
      return;
    }
    try {
      removeDarkMode();
      removePrivateKey();
      removeRelays();
    } finally { window.location.replace('/'); }
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
        <MessageInboxSettings inbox={dmInbox} relays={relayList} states={relayStates} giftHistory={giftHistory} />
        <label>
          <input type="checkbox" checked={primalEnabled} onChange={e => onPrimalChange(e.target.checked)} />
          Read history from Primal
        </label>
        <small>Primal receives your public key and your conversation partners’ public keys.</small>
        <button className={styles.logout} onClick={() => { setNotice(''); confirmation.current?.showModal(); }}>
          Logout
        </button>
        <button className={styles.close} onClick={() => setShowSettings(false)}>
          Close
        </button>
      </div>
      <dialog ref={confirmation} className={styles.confirmation} aria-labelledby="logout-title" aria-describedby="logout-warning"
        onCancel={e => { if (leaving) e.preventDefault(); }}
        onClick={e => {
          if (leaving || e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) e.currentTarget.close();
        }}>
        <h2 id="logout-title">Log out of MeShell?</h2>
        <p id="logout-warning">Have you saved your nsec? You’ll need this private key to sign in again. MeShell can’t recover it for you.</p>
        <div className={styles.confirmActions}>
          <button type="button" className={styles.copyKey} autoFocus disabled={leaving} onClick={copyNsec}>Copy nsec</button>
          <button type="button" className={styles.logout} disabled={leaving} onClick={logout}>Logout</button>
        </div>
        <p className={styles.copyStatus} role="status">{notice}</p>
      </dialog>
    </div>
  );
};

export default SettingsPage;

