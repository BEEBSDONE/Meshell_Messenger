import { useState } from 'react';
import type { InboxRelays } from '../hooks/useDefaultInbox';
import type { RelayHistory } from '../hooks/useHistory';
import type { RelayStates } from '../utils/history';
import { MAX_INBOX_RELAYS } from '../utils/inboxRelays';
import styles from './SettingsPage.module.css';

export default function MessageInboxSettings({ inbox, relays, states, giftHistory }: { inbox: InboxRelays; relays: string[]; states: RelayStates; giftHistory: RelayHistory }) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const options = [...new Set([...inbox.urls, ...relays])];
  async function publish() {
    if (selection && await inbox.publish(selection)) setSelection(null);
  }
  return <section className={styles.inbox} aria-label="Message inbox">
    <h3>Message inbox</h3>
    {selection !== null ? <>
      <p>One to three relays is usually enough for a custom inbox. Your relay list is public.</p>
      <div className={styles.inboxList}>
        {options.map(url => <label key={url}>
          <span>{url}</span>
          <span className={styles.checkboxSurface}>
            <input type="checkbox" checked={selection.includes(url)} disabled={inbox.publishing}
              onChange={e => setSelection(e.target.checked ? [...selection, url] : selection.filter(value => value !== url))} />
          </span>
        </label>)}
      </div>
      <div className={styles.inboxActions}>
        <button className={styles.publish} disabled={!inbox.checked || inbox.publishing || !selection.length || selection.length > MAX_INBOX_RELAYS} onClick={publish}>
          {inbox.publishing ? 'Publishing…' : 'Publish inbox relays'}
        </button>
        <button className={styles.secondaryAction} onClick={() => setSelection(null)} disabled={inbox.publishing}>Cancel</button>
      </div>
    </> : inbox.urls.length ? <>
      <p>Your public inbox lists the relays where people can send you private messages.</p>
      <ul className={styles.inboxList} aria-label="Published inbox relays">
        {inbox.urls.map(url => <li key={url}><span>{url}</span>{!relays.includes(url) &&
          <i className={styles.dot} data-state={giftHistory.status.byRelay[url] ?? 'checking'} role="img"
            aria-label={giftHistory.status.byRelay[url] === 'failed' ? 'Not synced' : giftHistory.status.byRelay[url] === 'synced' ? 'Synced' : 'Checking'} />}</li>)}
      </ul>
      <button className={styles.secondaryAction} onClick={() => setSelection(inbox.urls)}>Change inbox relays</button>
    </> : <>
      <p role="status">{inbox.issue || 'Checking your relays. MeShell will publish your synced relays as your public inbox.'}</p>
      {inbox.issue && !inbox.hasList && relays.length > 0 && <button className={styles.secondaryAction} onClick={inbox.retrySetup}>Retry inbox setup</button>}
      {inbox.issue && options.length > 0 && <button className={styles.secondaryAction} onClick={() => setSelection(options.filter(url => states[url] === 'synced'))}>Choose inbox relays</button>}
    </>}
    {inbox.urls.some(url => !relays.includes(url) && giftHistory.status.byRelay[url] === 'failed') &&
      <div className={styles.inboxActions}>Some inbox relays could not sync. <button className={styles.secondaryAction} onClick={giftHistory.retry}>Retry inbox sync</button></div>}
    {inbox.error && <small role="alert">{inbox.error}</small>}
  </section>;
}
