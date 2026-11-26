import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Event } from 'nostr-tools/pure';
import { openPrivateMessage, type Account, type Rumor } from '../utils/privateMessages';
import { pendingPeers } from '../utils/messageOutbox';
import { useRelayHistory } from './useHistory';
import type { InboxDirectory } from './useInboxRelays';

export default function usePrivateInbox(account: Account | null, inbox: InboxDirectory,
  onPeer: (peer: string, time: number) => void) {
  const [threads, setThreads] = useState<Record<string, Record<string, Rumor>>>({});
  const accept = useCallback((wrap: Event) => {
    if (!account) return;
    const message = openPrivateMessage(wrap, account);
    if (!message) return;
    const { peer, rumor } = message;
    onPeer(peer, rumor.created_at);
    setThreads(all => all[peer]?.[rumor.id] ? all : { ...all, [peer]: { ...all[peer], [rumor.id]: rumor } });
  }, [account, onPeer]);
  useEffect(() => {
    if (!account) return;
    let active = true;
    pendingPeers(account.pk).then(peers => { if (active) peers.forEach(peer => onPeer(peer, 0)); }).catch(() => {});
    return () => { active = false; };
  }, [account, onPeer]);
  const filters = useMemo(() => account ? [{ kinds: [1059], '#p': [account.pk] }] : [], [account]);
  const history = useRelayHistory(inbox.readRelays, filters, accept, inbox.signAuth);
  return { threads, history, accept };
}
