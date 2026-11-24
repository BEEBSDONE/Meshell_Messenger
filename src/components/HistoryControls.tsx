import type useHistory from '../hooks/useHistory';

interface Props {
  history: ReturnType<typeof useHistory>;
  items: 'messages' | 'conversations';
  empty: boolean;
}

export default function HistoryControls({ history, items, empty }: Props) {
  const { status, loadOlder, retry } = history;
  if (!status.total) return <p role="status">Add a relay in Settings to load {items}.</p>;
  return (
    <div className="historyControls">
      {status.loading && <span role="status">Loading {items}…</span>}
      {!status.loading && !status.failed && empty && !status.hasOlder && <span>No {items} found on these relays.</span>}
      {status.failed > 0 && (
        <span role="status">
          {status.failed} of {status.total} relays could not sync. <button onClick={retry} disabled={status.loading}>Retry</button>
        </span>
      )}
      {status.crowded && <span>A relay may have more messages at the same timestamp than it will return.</span>}
      {status.hasOlder && !status.loading && <button onClick={loadOlder}>Load older {items}</button>}
    </div>
  );
}
