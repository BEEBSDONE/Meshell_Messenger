import type useHistory from '../hooks/useHistory';

interface Props {
  history: ReturnType<typeof useHistory>;
  items: 'messages' | 'conversations';
  empty: boolean;
}

export default function HistoryControls({ history, items, empty }: Props) {
  const { status, primal, loadOlder, retry } = history;
  const relayPage = status.hasOlder && !status.loading;
  const archivePage = primal.state === 'more';
  const archiveOff = primal.state === 'off';
  const relayDone = !status.loading && !status.failed && !status.hasOlder;
  const load = () => {
    if (relayPage) loadOlder();
    if (archivePage) primal.next();
  };

  return (
    <div className="historyControls">
      {status.loading && <span role="status">Loading {items}…</span>}
      {primal.state === 'loading' && <span role="status">Checking Primal history…</span>}
      {!status.total && archiveOff && <span>No relays configured.</span>}
      {empty && relayDone && archiveOff && status.total > 0 && <span>No {items} found on these relays.</span>}
      {empty && primal.state === 'empty' && (
        <span role="status">{items === 'conversations' ? 'Primal returned no archived conversations for this account.' :
          'Primal returned no archived messages for this conversation.'}</span>
      )}
      {status.failed > 0 && (
        <span role="status">
          {status.failed} of {status.total} relays could not sync. <button onClick={retry} disabled={status.loading}>Retry</button>
        </span>
      )}
      {primal.state === 'error' && <span role="status">Primal could not finish loading history. <button onClick={primal.next}>Retry Primal</button></span>}
      {status.crowded && <span>A relay may have more messages at the same timestamp than it will return.</span>}
      {(relayPage || archivePage) && <button onClick={load}>Load older {items}</button>}
    </div>
  );
}
