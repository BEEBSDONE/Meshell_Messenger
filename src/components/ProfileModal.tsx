import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify'; // Import DOMPurify
import styles from './ProfileModal.module.css';
import { decodeNsec, encodeNpub, createEvent } from '../utils/nostr';
import { getNsec, getRelays } from '../utils/storage';
import { getPublicKey } from 'nostr-tools/pure';
import ProfilePicture from './ProfilePicture';
import { SimplePool } from 'nostr-tools/pool';
import { BlossomUploader } from '@nostrify/nostrify/uploaders';

interface ProfileModalProps {
  setShowProfileModal: (show: boolean) => void;
  darkMode: boolean;
}

interface Content {
  name: string;
  picture?: string;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ setShowProfileModal, darkMode }) => {
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [npub, setNpub] = useState<string>('');
  const [nsec, setNsec] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string>('');

  useEffect(() => {
    const initializeProfile = async () => {
      const storedNsec = await getNsec();
      if (storedNsec) {
        setNsec(storedNsec);
        try {
          const sk = decodeNsec(storedNsec);
          const pubkey = getPublicKey(sk);
          const encodedNpub = encodeNpub(pubkey);
          const pool = new SimplePool();
          setNpub(encodedNpub);
          let relays = getRelays();

          const metadata = pool.subscribeMany(
            [...relays],
            [
              {
                authors: [pubkey],
                kinds: [0],
              },
            ],
            {
              onevent(event) {
                const contentObj: Content = JSON.parse(event.content);
                setNickname(contentObj.name);
                setProfilePicture(contentObj.picture || null);
              },
              oneose() {
                metadata.close();
              },
            }
          );
        } catch (error) {
          console.error('Error decoding nsec or fetching profile:', error);
        }
      }
    };

    initializeProfile();
  }, []);

  const handleProfilePictureChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      try {
        const storedNsec = await getNsec();
        if (!storedNsec) {
          console.error('No private key found.');
          return;
        }

        const sk = decodeNsec(storedNsec);
        const pubkey = getPublicKey(sk);

        const signer = {
          signEvent: async (event: any) => {
            return createEvent(sk, event);
          },
          pubkey,
          getPublicKey: async () => pubkey
        };

        const uploader = new BlossomUploader({
          servers: [
            'https://blossom.primal.net/',
            'https://cdn.satellite.earth/',
          ],
          signer,
          fetch: window.fetch.bind(window),
        });

        const tags = await uploader.upload(file);
        const urlTag = tags.find((tag) => tag[0] === 'url');

        if (urlTag) {
          const profilePictureUrl = urlTag[1];
          setProfilePicture(profilePictureUrl);
        } else {
          console.error('No URL tag found in the response.');
        }
      } catch (error) {
        console.error('Error uploading image:', error);
      }
    }
  };

  const handleSave = async () => {
    const storedNsec = await getNsec();
    if (storedNsec) {
      try {
        const poolsend = new SimplePool();
        let relays = getRelays();
        const sk = decodeNsec(storedNsec);
        const eventTemplate = {
          kind: 0,
          content: JSON.stringify({
            name: DOMPurify.sanitize(nickname),
            picture: profilePicture,
          }),
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        };
        const event = createEvent(sk, eventTemplate);
        try {
          await poolsend.publish(relays, event);
          setShowProfileModal(false);
        } catch (error) {
          console.error('Error sending metadata update:', error);
        }
      } catch (error) {
        console.error('Error updating profile:', error);
      }
    }
  };

  return (
    <div className={styles.modal}>
      <div className={styles.modalContent}>
        {/* Profile Picture Section */}
        <div className={styles.profilePictureSection}>
          {profilePicture ? (
            <img
              src={profilePicture}
              alt="Profile"
              className={styles.profilePicture}
            />
          ) : (
            <ProfilePicture pubkey={nsec ? getPublicKey(decodeNsec(nsec)) : ''} isDarkMode={darkMode} />
          )}
          <label className={styles.uploadButton}>
            Upload Avatar
            <input type="file" onChange={handleProfilePictureChange} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Username Section */}
        <div className={styles.usernameSection}>
          <label htmlFor="nickname" className={styles.usernameLabel}>Username</label>
          <input
            type="text"
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className={styles.input}
          />
        </div>

        {/* Npub Section */}
        <div className={styles.npubSection}>
          <input type="text" id="npub" value={npub} readOnly className={styles.input} />
          <button onClick={() => navigator.clipboard.writeText(npub)} className={styles.copyButton}>
            Copy
          </button>
        </div>

        {/* Nsec Section */}
        <div className={styles.nsecSection}>
          <input type="text" id="nsec" value="Private key, click to copy!" readOnly className={styles.input} />
          <button onClick={() => navigator.clipboard.writeText(nsec || '')} className={styles.copyButton}>
            Copy
          </button>
        </div>

        {/* Action Buttons */}
        <div className={styles.modalActions}>
          <button onClick={handleSave} className={styles.saveButton}>
            Save
          </button>
          <button onClick={() => setShowProfileModal(false)} className={styles.cancelButton}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;

