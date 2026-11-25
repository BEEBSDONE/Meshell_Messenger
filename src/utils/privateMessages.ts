import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { v2 } from 'nostr-tools/nip44';
import { getEventHash, validateEvent, verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure';

export interface Account { pk: string; sk: Uint8Array }
export type Rumor = UnsignedEvent & { id: string };
export interface PrivateDraft { peer: string; toPeer: Event; toSelf: Event; delivered: boolean }

export function prepareMessage(account: Account, peer: string, text: string): PrivateDraft {
  // An encrypted, per-message nonce distinguishes intentional identical texts sent in the same second.
  const rumor = createRumor({ kind: 14, content: text, tags: [['p', peer], ['client_nonce', crypto.randomUUID()]] }, account.sk);
  const wrap = (recipient: string) => createWrap(createSeal(rumor, account.sk, recipient), recipient);
  const toPeer = wrap(peer);
  return { peer, toPeer, toSelf: peer === account.pk ? toPeer : wrap(account.pk), delivered: false };
}

function signedEvent(value: unknown): value is Event {
  return validateEvent(value) && 'sig' in value && typeof value.sig === 'string' &&
    'id' in value && typeof value.id === 'string' && verifyEvent(value as Event);
}

function openLayer(event: Event, sk: Uint8Array): unknown {
  return JSON.parse(v2.decrypt(event.content, v2.utils.getConversationKey(sk, event.pubkey)));
}

export function openPrivateMessage(wrap: Event, account: Account): { peer: string; rumor: Rumor } | undefined {
  try {
    const recipients = wrap.tags.filter(tag => tag[0] === 'p');
    if (wrap.kind !== 1059 || recipients.length !== 1 || recipients[0][1] !== account.pk || !verifyEvent(wrap)) return;
    const seal = openLayer(wrap, account.sk);
    if (!signedEvent(seal) || seal.kind !== 13 || seal.tags.length) return;
    const rumor = openLayer(seal, account.sk);
    if (!validateEvent(rumor) || rumor.kind !== 14 || 'sig' in rumor || rumor.pubkey !== seal.pubkey ||
        !Number.isSafeInteger(rumor.created_at) || rumor.created_at < 0 || rumor.created_at > 8.64e12 ||
        !('id' in rumor) || typeof rumor.id !== 'string' || rumor.id !== getEventHash(rumor)) return;
    const people = new Set<string>([rumor.pubkey]);
    const addressed = rumor.tags.filter(tag => tag[0] === 'p');
    if (!addressed.length) return;
    for (const tag of addressed) {
      if (!/^[a-f0-9]{64}$/.test(tag[1])) return;
      people.add(tag[1]);
    }
    if (!people.delete(account.pk) || people.size > 1) return;
    return { peer: people.values().next().value ?? account.pk, rumor: { ...rumor, id: rumor.id } };
  } catch { /* Ignore unsupported or unauthentic envelopes without exposing their contents. */ }
}
