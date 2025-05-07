import { decodeNsec } from './nostr';  // Make sure to import the necessary utility
import { getPublicKey } from 'nostr-tools/pure';  // Ensure you're using nostr-tools
import { storeEncryptedNsec, getEncryptedNsec, clearNsec } from './secureStorage';

export const storeNsec = async (nsec: string): Promise<void> => {
  await storeEncryptedNsec(nsec);
};

export const getNsec = async (): Promise<string | null> => {
  return await getEncryptedNsec();
};

// Function to get hex-encoded private key from local storage
export const getPrivateKey = (): string | null => {
  return localStorage.getItem('privateKey'); // This assumes you store the private key as 'privateKey' in hex format
};

export const removeNsec = async (): Promise<void> => {
  await clearNsec();
};

export const getRelays = (): string[] => {
  const relays = localStorage.getItem('relays');
  if (relays) {
    try {
      const parsedRelays = JSON.parse(relays);
      if (Array.isArray(parsedRelays)) {
        return parsedRelays;
      } else {
        console.error('Relays data is not an array:', parsedRelays);
        return [];
      }
    } catch (error) {
      console.error('Error parsing relays from localStorage:', error);
      return [];
    }
  } else {
    return [];
  }
};

export const removeRelays = (): void => {
  localStorage.removeItem('relays');
};

export const removePrivateKey = (): void => {
  localStorage.removeItem('privateKey');
};

export const removeDarkMode = (): void => {
  localStorage.removeItem('darkMode');
};

export const setRelays = (relays: string[]): void => {
  localStorage.setItem('relays', JSON.stringify(relays));
};

// Dark Mode Persistence
export const getDarkMode = (): boolean => {
  const darkMode = localStorage.getItem('darkMode');
  return darkMode ? JSON.parse(darkMode) : false; // Default to false
};

export const setDarkMode = (isDarkMode: boolean): void => {
  console.log(`Setting dark mode to: ${isDarkMode}`);
  localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
};

// Add or confirm this function for saving the nickname to localStorage
export const storeNickname = (nickname: string): void => {
  localStorage.setItem('nickname', nickname);
};

// Function to retrieve the stored nickname
export const getNickname = (): string | null => {
  return localStorage.getItem('nickname');
};

// Function to store the profile picture in localStorage
export const storeProfilePicture = (profilePictureUrl: string): void => {
  localStorage.setItem('profilePicture', profilePictureUrl);
};

// Function to retrieve the stored profile picture
export const getProfilePicture = (): string | null => {
  return localStorage.getItem('profilePicture');
};

// Function to retrieve the public key from the stored nsec
export const getPublicKeyFromNsec = async (): Promise<string | null> => {
  const nsec = await getNsec();
  if (!nsec) {
    return null;
  }

  try {
    const privateKey = decodeNsec(nsec);
    const publicKey = getPublicKey(privateKey);
    return publicKey;
  } catch (error) {
    console.error('Error decoding nsec or getting public key:', error);
    return null;
  }
};

