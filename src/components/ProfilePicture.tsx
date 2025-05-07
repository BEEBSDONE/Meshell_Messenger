import React, { useEffect, useState } from 'react';
import { pool } from '../utils/nostr';
import { getRelays } from '../utils/storage';
import styles from './ProfilePicture.module.css';
import { Event as NostrEvent } from 'nostr-tools';

interface ProfilePictureProps {
  pubkey: string;
  isDarkMode: boolean;
}

const ProfilePicture: React.FC<ProfilePictureProps> = ({ pubkey, isDarkMode }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    // Reset image URL when pubkey changes
    setImageUrl(null);
    
    const fetchProfilePicture = async () => {
      const relays = getRelays();
      const relayUrls = relays.length > 0 ? relays : ['wss://relay.damus.io'];

      const sub = pool.subscribeMany(
        relayUrls,
        [
          {
            kinds: [0],
            authors: [pubkey],
          },
        ],
        {
          onevent: (event: NostrEvent) => {
            try {
              const metadata = JSON.parse(event.content);
              if (metadata.picture) {
                setImageUrl(metadata.picture);
              }
            } catch (error) {
              console.error('Error parsing metadata:', error);
            } finally {
              sub.close();
            }
          },
          oneose: () => {
            sub.close();
          },
        }
      );

      // Cleanup subscription after 5 seconds if no profile picture is found
      setTimeout(() => {
        sub.close();
      }, 5000);
    };

    fetchProfilePicture();
  }, [pubkey]);

  return (
    <div className={`${styles.profilePicture} ${isDarkMode ? styles.darkMode : ''}`}>
      {imageUrl ? (
        <img src={imageUrl} alt="Profile" className={styles.profileImage} />
      ) : (
        <div className={styles.noProfilePicture} />
      )}
    </div>
  );
};

export default ProfilePicture;

