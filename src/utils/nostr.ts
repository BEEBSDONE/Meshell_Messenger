import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import type { Event as NostrEvent, EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import {
  finalizeEvent,
  verifyEvent,
} from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';

// Event kinds
export const KIND_METADATA = 0; // User metadata
export const KIND_TEXT_NOTE = 1; // Text note
export const KIND_CONTACT_LIST = 3; // Contact list
export const KIND_ENCRYPTED_DIRECT_MESSAGE = 4; // Encrypted direct message (NIP-04)

// Initialize SimplePool
export const pool = new SimplePool();

// Function to decode nsec (private key) using NIP-19
export const decodeNsec = (nsec: string): Uint8Array => {
  const { type, data } = nip19.decode(nsec);
  if (type !== 'nsec' || data.length !== 32) throw new Error('Invalid nsec');
  return data;
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
  return privateKeyFromSeedWords(mnemonic, passphrase, accountIndex);
};

// publish() returns one promise per relay. Resolve on the first acknowledgement.
export type AuthSigner = (event: EventTemplate) => Promise<VerifiedEvent>;
export async function publishConfirmed(relays: string[], event: NostrEvent, onauth?: AuthSigner): Promise<void> {
  const acknowledgements = pool.publish(relays, event, { onauth, maxWait: 10_000 });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.any(acknowledgements),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('No relay confirmed publication')), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
