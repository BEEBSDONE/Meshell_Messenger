import { verifyEvent, compareEvents, type Event } from 'nostr-tools/pure';
import { normalizeRelayUrl } from './storage';
import { pool } from './nostr';

function usableInboxRelay(value: unknown, configured: string[]): string | null {
  const url = normalizeRelayUrl(value);
  if (!url) return null;
  if (configured.includes(url)) return url;
  // Discovered lists are remote input. Private hosts require explicit local configuration.
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  if (!url.startsWith('wss://')) return null;
  if (host.startsWith('[')) return /^\[[23][0-9a-f]{3}:/.test(host) ? url : null;
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') ||
      host.endsWith('.internal') || /^(0|10|127)\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return null;
  return url;
}

export function inboxUrls(event: Event | undefined, configured: string[]): string[] {
  const urls = new Set<string>();
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'relay') continue;
    const url = usableInboxRelay(tag[1], configured);
    if (url) urls.add(url);
    if (urls.size === 16) break;
  }
  return [...urls];
}

export function validInbox(event: Event, pubkey: string) {
  return event.kind === 10050 && event.pubkey === pubkey && Number.isSafeInteger(event.created_at) && event.created_at >= 0 && verifyEvent(event);
}

export async function findInbox(pubkey: string, discovery: string[], configured: string[]) {
  const events = await pool.querySync(discovery, { kinds: [10050], authors: [pubkey], limit: 1 }, { maxWait: 5500 });
  const latest = events.filter(event => validInbox(event, pubkey)).sort(compareEvents)[0];
  return inboxUrls(latest, configured);
}
