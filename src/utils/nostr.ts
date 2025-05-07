import { SimplePool } from 'nostr-tools/pool'; // Correct import for SimplePool
import {
  nip19,
  Event as NostrEvent,
} from 'nostr-tools';
import {
  finalizeEvent,
  verifyEvent,
} from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';

// Event kinds
export const KIND_METADATA = 0; // User metadata
export const KIND_TEXT_NOTE = 1; // Text note
export const KIND_CONTACT_LIST = 3; // Contact list
export const KIND_ENCRYPTED_DIRECT_MESSAGE = 4; // Encrypted direct message (NIP-04)
export const KIND_EPHEMERAL_MESSAGE = 20000; // NIP-17 Ephemeral event kind

// Initialize SimplePool
export const pool = new SimplePool();

// Function to decode nsec (private key) using NIP-19
export const decodeNsec = (nsec: string): Uint8Array => {
  const { type, data } = nip19.decode(nsec);
  console.log('Decoded nsec:', { type, data });
  if (type !== 'nsec') throw new Error('Invalid nsec');

  if (data instanceof Uint8Array) {
    // Data is already Uint8Array
    return data;
  } else if (typeof data === 'string') {
    // Data is hex string
    return hexToBytes(data);
  } else if (typeof data === 'object' && data !== null && 'privateKey' in data) {
    // If data is an object with a privateKey property
    const privateKeyHex = (data as { privateKey: string }).privateKey;
    return hexToBytes(privateKeyHex);
  } else {
    throw new Error('Invalid data format in decoded nsec');
  }
};

// Function to encode npub (public key) using NIP-19
export const encodeNpub = (pubkey: string): string => {
  return nip19.npubEncode(pubkey);
};

// Function to create and sign an event
export const createEvent = (
  sk: Uint8Array,
  eventTemplate: Partial<NostrEvent>
): NostrEvent => {
  // Ensure required properties are set
  if (
    typeof eventTemplate.kind !== 'number' ||
    typeof eventTemplate.content !== 'string'
  ) {
    throw new Error('Event kind and content are required.');
  }

  const event = {
    kind: eventTemplate.kind,
    content: eventTemplate.content,
    tags: eventTemplate.tags || [],
    created_at: eventTemplate.created_at || Math.floor(Date.now() / 1000),
  };

  const finalizedEvent = finalizeEvent(event, sk);
  return finalizedEvent;
};

export { finalizeEvent, verifyEvent };

// (Optional) Derive private key from mnemonic (NIP-06)
export const derivePrivateKeyFromMnemonic = (
  mnemonic: string,
  passphrase: string = '',
  accountIndex: number = 0
): Uint8Array => {
  const privateKeyHex = privateKeyFromSeedWords(mnemonic, passphrase, accountIndex);
  return hexToBytes(privateKeyHex);
};

