import React, { lazy, Suspense, useState } from 'react';
import styles from './ConversationList.module.css';
import ProfilePicture from './ProfilePicture';
import NewConversationModal from './NewConversationModal';
import SettingsPage from './SettingsPage';
import { setDarkMode as storeDarkMode } from '../utils/storage';
import MeshellLogo from '../assets/MeShell_Logo.svg';

import type { InboxRelays } from '../hooks/useDefaultInbox';
import type { Conversation } from './ChatPage';
import type useHistory from '../hooks/useHistory';
import type { RelayHistory } from '../hooks/useHistory';
import type { RelayStates } from '../utils/history';
import HistoryControls from './HistoryControls';
import type { Account } from '../utils/privateMessages';
import type { CacheStatus } from '../utils/messageCache';

const ProfileModal = lazy(() => import('./ProfileModal'));

interface ConversationListProps {
  cacheStatus: CacheStatus;
  onCacheChange: (enabled: boolean) => void;
  account: Account;
  conversations: Conversation[];
  dmInbox: InboxRelays;
  giftHistory: RelayHistory;
  onCopyNsec: () => Promise<void>;
  onSelect: (pubkey: string) => void;
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  history: ReturnType<typeof useHistory>;
  relays: string[];
  relayStates: RelayStates;
  onRetryRelays: () => void;
  primalEnabled: boolean;
  onPrimalChange: (enabled: boolean) => void;
  onRelaysChange: (relays: string[]) => void;
}

const ConversationList: React.FC<ConversationListProps> = ({
  cacheStatus, onCacheChange, account, conversations, dmInbox, giftHistory, onSelect, onCopyNsec, darkMode, setDarkMode, history, relays, relayStates, onRetryRelays, onRelaysChange, primalEnabled, onPrimalChange,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const toggleDropdown = () => setIsDropdownOpen(!isDropdownOpen);

  const toggleDarkMode = () => {
    const newDarkModeValue = !darkMode;
    setDarkMode(newDarkModeValue);
    storeDarkMode(newDarkModeValue);
  };

  return (
    <div className={styles.conversationList}>
      <div className={styles.header}>
        <div className={styles.hamburgerMenu}>
          <button type="button" aria-label="Menu" aria-expanded={isDropdownOpen} className={styles.menuButton} onClick={toggleDropdown}>
            <span className={styles.hamburgerLine}></span>
            <span className={styles.hamburgerLine}></span>
            <span className={styles.hamburgerLine}></span>
          </button>
          {isDropdownOpen && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownItem} onClick={() => { setShowProfileModal(true); setIsDropdownOpen(false); }}>
                Profile
              </div>
              <button type="button" className={styles.dropdownItem} onClick={() => { setShowSettings(true); setIsDropdownOpen(false); }}>
                Settings
              </button>
              <div className={styles.dropdownItem}>
                <label className={styles.switch}>
                  <input type="checkbox" aria-label="Dark mode" checked={darkMode} onChange={toggleDarkMode} />
                  <span className={styles.slider}>
                    {darkMode ? (
                      <i className={styles.moonIcon}></i>
                    ) : (
                      <i className={styles.sunIcon}></i>
                    )}
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        <img src={MeshellLogo} alt="Meshell Logo" className={styles.logo} />
        <button className={styles.newConversationButton} onClick={() => setShowNewConversationModal(true)}>
          +
        </button>
      </div>

      <div aria-label="Conversations" role="region" className={styles.conversationsContainer}>
        {conversations.map(conversation => (
          <button type="button" key={conversation.pubkey} className={styles.conversationItem}
            title={conversation.name} onClick={() => onSelect(conversation.pubkey)}>
            <ProfilePicture picture={conversation.picture} isDarkMode={darkMode} />
            <span className={styles.conversationName}>{conversation.name}</span>
          </button>
        ))}
        <HistoryControls history={history} items="conversations" empty={!conversations.length} />
      </div>

      {showNewConversationModal && (
        <NewConversationModal
          setShowNewConversationModal={setShowNewConversationModal}
          onSelect={onSelect}
        />
      )}

      {showSettings && <SettingsPage cacheStatus={cacheStatus} onCacheChange={onCacheChange} dmInbox={dmInbox} giftHistory={giftHistory} onCopyNsec={onCopyNsec} setShowSettings={setShowSettings} relayList={relays} onChange={onRelaysChange}
        relayStates={relayStates} onRetryRelays={onRetryRelays} primalEnabled={primalEnabled} onPrimalChange={onPrimalChange} />}
      {showProfileModal && <Suspense fallback={<p role="status">Opening profile…</p>}><ProfileModal account={account} setShowProfileModal={setShowProfileModal} darkMode={darkMode} /></Suspense>}
    </div>
  );
};

export default ConversationList;

