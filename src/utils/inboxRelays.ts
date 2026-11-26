import { verifyEvent, compareEvents, type Event } from 'nostr-tools/pure';
import { subscribeRelay } from './history';
import { normalizeRelayUrl } from './storage';
import { pool, type AuthSigner } from './nostr';

export const MAX_INBOX_RELAYS = 16;

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
    if (urls.size === MAX_INBOX_RELAYS) break;
  }
  return [...urls];
}

export function validInbox(event: Event, pubkey: string) {
  return event.kind === 10050 && event.pubkey === pubkey && Number.isSafeInteger(event.created_at) && event.created_at >= 0 && verifyEvent(event);
}

// Keep our own directory subscription live. A recipient lookup ends at EOSE
// (or the deadline), including subscriptions reopened after an AUTH challenge.
export function watchInbox(pubkey: string, urls: string[], sign: AuthSigner | undefined,
  onEvent: (event: Event) => void, onReady: (checked: Set<string>) => void, keepOpen: boolean) {
  let active = true, ready = false;
  const subscriptions = new Set<ReturnType<typeof subscribeRelay>>();
  const finished = new Set<string>();
  const checked = new Set<string>();
  const timer = setTimeout(reportReady, 5500);
  function close() {
    active = false;
    clearTimeout(timer);
    for (const sub of subscriptions) sub.close();
    subscriptions.clear();
  }
  function reportReady() {
    if (!active || ready) return;
    ready = true;
    clearTimeout(timer);
    if (!keepOpen) close();
    onReady(checked);
  }
  function finish(url: string) {
    finished.add(url);
    if (finished.size === urls.length) reportReady();
  }
  for (const url of urls) {
    void pool.ensureRelay(url, { connectionTimeout: 5000 }).then(relay => {
      if (!active) return;
      const sub = subscribeRelay(relay, [{ kinds: [10050], authors: [pubkey], limit: 1 }], {
        // Only a real EOSE before our deadline confirms the directory was read.
        eoseTimeout: 15_000,
        onevent(event) { if (active && validInbox(event, pubkey)) onEvent(event); },
        oneose: () => { if (!ready) checked.add(url); finish(url); },
        onclose: () => finish(url),
      }, sign);
      subscriptions.add(sub);
    }).catch(() => finish(url));
  }
  if (!urls.length) reportReady();
  return close;
}

export function findInbox(pubkey: string, discovery: string[], configured: string[], sign?: AuthSigner): Promise<string[]> {
  return new Promise(resolve => {
    let latest: Event | undefined;
    watchInbox(pubkey, discovery, sign, event => {
      if (!latest || compareEvents(event, latest) < 0) latest = event;
    }, () => resolve(inboxUrls(latest, configured)), false);
  });
}
