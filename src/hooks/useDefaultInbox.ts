import { useEffect, useState } from 'react';
import type { InboxDirectory } from './useInboxRelays';
import type { RelayStates } from '../utils/history';
import { MAX_INBOX_RELAYS } from '../utils/inboxRelays';

export default function useDefaultInbox(directory: InboxDirectory, configured: string[], states: RelayStates,
  retrySync: () => void, justRegistered: boolean) {
  const { hasList, checked, urls, publish, refresh } = directory;
  const [failure, setFailure] = useState<{ checked: Set<string>; plan: string }>();
  const synced = configured.filter(url => states[url] === 'synced');
  const checking = configured.some(url => !states[url] || states[url] === 'checking');
  let issue = '';
  let plan = '';
  if (hasList) {
    if (!urls.length) issue = 'Your published inbox has no usable relays. Choose inbox relays in Settings to receive messages.';
  } else if (!configured.length) {
    issue = 'Add a relay in Settings so MeShell can set up your inbox.';
  } else if (checked && !checking) {
    if (!synced.length) issue = 'No relay has synced yet. Try again when a relay is available.';
    // An imported key can already have a list on a relay whose directory lookup failed.
    else if (!justRegistered && synced.some(url => !checked.has(url))) issue = 'MeShell couldn’t check for an existing inbox on every synced relay. Try again.';
    else plan = JSON.stringify(synced.slice(0, MAX_INBOX_RELAYS));
  }
  // The same set of healthy relays can be reported many times during history updates.
  useEffect(() => {
    if (!plan || !checked) return;
    const controller = new AbortController();
    setFailure(undefined);
    void publish(JSON.parse(plan), controller.signal).then(ok => {
      if (!ok && !controller.signal.aborted) setFailure({ checked, plan });
    });
    return () => controller.abort();
  }, [plan, checked, publish]);
  if (plan && failure?.checked === checked && failure?.plan === plan) {
    issue = 'No relay confirmed your inbox list. Try again.';
  }
  function retrySetup() { refresh(); retrySync(); }
  return { ...directory, issue, retrySetup };
}
export type InboxRelays = ReturnType<typeof useDefaultInbox>;
