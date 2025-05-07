import React, { useEffect, useState } from 'react';
import { pool } from '../utils/nostr';
import { getRelays } from '../utils/storage';
import styles from './ProfileProfilePicture.module.css';
import { Event as NostrEvent } from 'nostr-tools';

interface ProfilePictureProps {
  pubkey: string; // hex string
}

const ProfilePicture: React.FC<ProfilePictureProps> = ({ pubkey }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfilePicture = async () => {
      const relays = getRelays();
      const relayUrls = relays.length > 0 ? relays : ['wss://relay.damus.io'];

      console.log('Subscribing to relays for profile picture:', relayUrls);

      const sub = pool.subscribeMany(
        relayUrls,
        [
          {
            kinds: [0], // Kind 0: Metadata events
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
    };

    fetchProfilePicture();
  }, [pubkey]);

  return (
    <div className={styles.profilePicture}>
      {imageUrl ? (
        <img src={imageUrl} alt="Profile" className={styles.profileImage} />
      ) : (
        <div className={styles.noProfilePicture} />
      )}
    </div>
  );
};

export default ProfilePicture;

