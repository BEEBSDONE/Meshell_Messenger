import { useEffect, useRef, useState } from 'react';
import type { Account } from '../utils/privateMessages';
import type { PushDevice } from '../utils/secureStorage';
import { changeEvent, enablePush, pushSetup, readDevice, removeDevice, supported } from '../utils/push';

export default function PushSettings({ account, vaultId }: { account: Account; vaultId: string }) {
  const [record, setRecord] = useState<PushDevice>();
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof pushSetup>>>();
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const available = supported();
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const refresh = () => { void readDevice().then(value => {
      if (active) setRecord(value?.vaultId === vaultId ? value : undefined);
    }).catch(() => { if (active) setIssue('Could not read device settings.'); }); };
    const storage = (e: StorageEvent) => { if (e.key === changeEvent) refresh(); };
    refresh();
    if (available) void pushSetup().then(value => { if (active) setSetup(value); })
      .catch(() => { if (active) setIssue('Notification setup is unavailable. Reconnect and retry.'); });
    window.addEventListener(changeEvent, refresh); window.addEventListener('storage', storage);
    return () => {
      active = false; mounted.current = false;
      window.removeEventListener(changeEvent, refresh); window.removeEventListener('storage', storage);
    };
  }, [available, vaultId, attempt]);
  const blocked = available && Notification.permission === 'denied';
  const enabled = !!record;
  async function toggle() {
    setBusy(true); setIssue('');
    try {
      if (record) await removeDevice(record.token);
      else if (setup) await enablePush(account, vaultId, setup, record);
    } catch (reason) {
      if (mounted.current) setIssue(reason instanceof Error && reason.name !== 'NotAllowedError'
        ? reason.message : 'Allow notifications in your browser settings to enable them.');
    } finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <label><input type="checkbox" checked={enabled} disabled={busy || (!enabled && (!available || !setup || blocked))} onChange={toggle} />
      Enable notifications on this device</label>
    <small>{!available ? 'Use a browser with Web Push. On iPhone or iPad, open MeShell from the Home Screen.' :
      blocked ? 'Notifications are blocked in your browser settings.' :
      record && !record.active ? 'Registration is pending. Reconnect to finish or turn this off.' :
      'Show a private alert for messages sent from MeShell.'}</small>
    {issue && <small role="status">{issue} {available && !setup && <button type="button"
      onClick={() => { setIssue(''); setAttempt(n => n + 1); }}>Retry notifications</button>}</small>}
  </>;
}
