import React, { useState, useEffect } from 'react';
import styles from './ConversationList.module.css';
import ProfilePicture from './ProfilePicture';
import NewConversationModal from './NewConversationModal';
import SettingsPage from './SettingsPage';
import ProfileModal from './ProfileModal';
import { setDarkMode as storeDarkMode, getDarkMode } from '../utils/storage';
import MeshellLogo from '../assets/MeShell_Logo.svg';

interface Conversation {
  id: string;
  pubkey: string;
  name: string;
  latestMessageTimestamp: number;
}

interface ConversationListProps {
  conversations: Conversation[];
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  setCurrentConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  darkMode: boolean;
  setDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  setConversations,
  setCurrentConversation,
  darkMode,
  setDarkMode,
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

  useEffect(() => {
    const savedDarkMode = getDarkMode();
    if (savedDarkMode !== null) {
      setDarkMode(savedDarkMode);
    }
  }, [setDarkMode]);

  return (
    <div className={styles.conversationList}>
      <div className={styles.header}>
        <div className={styles.hamburgerMenu} onClick={toggleDropdown}>
          <span className={styles.hamburgerLine}></span>
          <span className={styles.hamburgerLine}></span>
          <span className={styles.hamburgerLine}></span>
          {isDropdownOpen && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownItem} onClick={() => setShowProfileModal(true)}>
                Profile
              </div>
              <div className={styles.dropdownItem} onClick={() => setShowSettings(true)}>
                Settings
              </div>
              <div className={styles.dropdownItem}>
                <label className={styles.switch}>
                  <input type="checkbox" checked={darkMode} onChange={toggleDarkMode} />
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

      <div className={styles.conversationsContainer}>
        {conversations.length === 0 ? (
          <div className={styles.noConversations}>No conversations</div>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={styles.conversationItem}
              onClick={() => setCurrentConversation(conversation)}
            >
              <ProfilePicture pubkey={conversation.pubkey} isDarkMode={darkMode} />
              <div className={styles.conversationDetails}>
                <div className={styles.conversationName}>{conversation.name}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {showNewConversationModal && (
        <NewConversationModal
          setShowNewConversationModal={setShowNewConversationModal}
          setConversations={setConversations}
          conversations={conversations}
          setCurrentConversation={setCurrentConversation}
        />
      )}

      {showSettings && <SettingsPage setShowSettings={setShowSettings} />}
      {showProfileModal && <ProfileModal setShowProfileModal={setShowProfileModal} darkMode={darkMode} />}
    </div>
  );
};

export default ConversationList;

