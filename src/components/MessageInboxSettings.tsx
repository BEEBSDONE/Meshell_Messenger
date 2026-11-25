import { useState } from 'react';
import type { InboxRelays } from '../hooks/useInboxRelays';
import type { RelayHistory } from '../hooks/useHistory';
import type { RelayStates } from '../utils/history';
import styles from './SettingsPage.module.css';

export default function MessageInboxSettings({ inbox, relays, states, giftHistory }: { inbox: InboxRelays; relays: string[]; states: RelayStates; giftHistory: RelayHistory }) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const options = [...new Set([...inbox.urls, ...relays])];
  const editing = selection !== null || !inbox.urls.length;
  const choices = selection ?? options.filter(url => states[url] !== 'failed').slice(0, 3);
  async function publish() {
    if (await inbox.publish(choices)) setSelection(null);
  }
  return <section className={styles.inbox} aria-label="Message inbox">
    <h3>Message inbox</h3>
    {editing ? <>
      <p>Choose one to three relays for new private messages. Your published inbox list is public.</p>
      {options.map(url => <label key={url}>
        <input type="checkbox" checked={choices.includes(url)} disabled={inbox.publishing}
          onChange={e => setSelection(e.target.checked ? [...choices, url] : choices.filter(value => value !== url))} />
        {url}
      </label>)}
      {inbox.looking && !inbox.urls.length && <small>Checking for an existing inbox…</small>}
      <button disabled={inbox.looking || inbox.publishing || !choices.length || choices.length > 16} onClick={publish}>
        {inbox.publishing ? 'Publishing…' : 'Publish inbox relays'}
      </button>
      {inbox.urls.length > 0 && <button onClick={() => setSelection(null)} disabled={inbox.publishing}>Cancel</button>}
    </> : <>
      {inbox.urls.map(url => <p key={url}>{url} {!relays.includes(url) &&
        <i className={styles.dot} data-state={giftHistory.status.byRelay[url] ?? 'checking'} role="img"
          aria-label={giftHistory.status.byRelay[url] === 'failed' ? 'Not synced' : giftHistory.status.byRelay[url] === 'synced' ? 'Synced' : 'Checking'} />}</p>)}
      <button onClick={() => setSelection(inbox.urls)}>Change inbox relays</button>
    </>}
    {inbox.urls.some(url => !relays.includes(url) && giftHistory.status.byRelay[url] === 'failed') &&
      <div>Some inbox relays could not sync. <button onClick={giftHistory.retry}>Retry inbox sync</button></div>}
    {inbox.error && <small role="alert">{inbox.error}</small>}
  </section>;
}
