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

// The Primal lookup preference is independent of the opt-in device history.
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

export const removeDarkMode = (): void => {
  localStorage.removeItem('darkMode');
};

export const setRelays = (relays: string[]): void => {
  localStorage.setItem('relays', JSON.stringify(relays));
};

// Dark Mode Persistence
export const getDarkMode = (): boolean => {
  try { return localStorage.getItem('darkMode') !== 'false'; } catch { return true; }
};

export function applyDarkMode(dark: boolean): void {
  document.body.classList.toggle('darkMode', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1a1a' : '#ffffff');
}

export const setDarkMode = (isDarkMode: boolean): void => {
  try { localStorage.setItem('darkMode', JSON.stringify(isDarkMode)); } catch { /* The active tab can still switch themes. */ }
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
