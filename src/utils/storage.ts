import { decodeNsec } from './nostr';  // Make sure to import the necessary utility
import { getPublicKey } from 'nostr-tools/pure';  // Ensure you're using nostr-tools
import { storeEncryptedNsec, getEncryptedNsec, clearNsec } from './secureStorage';

export const ACCOUNT_CHANGE = 'meshell:account-change';
function notifyAccountChange() {
  try { localStorage.setItem(ACCOUNT_CHANGE, crypto.randomUUID()); } catch { /* IndexedDB is authoritative. */ }
}

export const storeNsec = async (nsec: string): Promise<void> => {
  await storeEncryptedNsec(nsec);
  notifyAccountChange();
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
  notifyAccountChange();
};

const defaultRelays = [
  'wss://relay.damus.io', 'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.band', 'wss://relay.snort.social', 'wss://relay.primal.net',
];

export function normalizeRelayUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) return null;
    if (url.username || url.password || url.hash) return null;
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function getRelays(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('relays') || 'null');
    if (Array.isArray(saved)) {
      const valid = saved.map(normalizeRelayUrl).filter((url): url is string => url !== null);
      if (!saved.length || valid.length) return [...new Set(valid)];
    }
  } catch { /* Recover malformed settings with the original defaults. */ }
  return [...defaultRelays];
}

// Only the user's choice is persistent. Archived messages stay in memory.
export function primalHistoryEnabled(pubkey: string): boolean {
  const saved = localStorage.getItem('primalHistory:' + pubkey);
  return saved === null || saved === 'enabled';
}

export function setPrimalHistoryEnabled(pubkey: string, enabled: boolean) {
  localStorage.setItem('primalHistory:' + pubkey, enabled ? 'enabled' : 'disabled');
}

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

