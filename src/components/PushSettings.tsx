import { useEffect, useRef, useState } from 'react';
import type { Account } from '../utils/privateMessages';
import type { PushDevice } from '../utils/secureStorage';
import { changeEvent, enablePush, pushSetup, readDevice, removeDevice, supported } from '../utils/push';
import DevicePreference from './DevicePreference';
import styles from './SettingsPage.module.css';

export default function PushSettings({ account, vaultId }: { account: Account; vaultId: string }) {
  const [record, setRecord] = useState<PushDevice>();
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof pushSetup>>>();
  const [pending, setPending] = useState<boolean | null>(null);
  const [issue, setIssue] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const available = supported();
  const blocked = available && Notification.permission === 'denied';
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const refresh = () => { void readDevice().then(value => {
      if (active) setRecord(value?.vaultId === vaultId ? value : undefined);
    }).catch(() => { if (active) setIssue('Could not read device settings.'); }); };
    const storage = (e: StorageEvent) => { if (e.key === changeEvent) refresh(); };
    refresh();
    if (available && !blocked) void pushSetup().then(value => { if (active) setSetup(value); })
      .catch(() => { if (active) setIssue('Notification setup is unavailable. Reconnect and retry.'); });
    window.addEventListener(changeEvent, refresh); window.addEventListener('storage', storage);
    return () => {
      active = false; mounted.current = false;
      window.removeEventListener(changeEvent, refresh); window.removeEventListener('storage', storage);
    };
  }, [available, blocked, vaultId, attempt]);
  const enabled = !!record;
  async function toggle() {
    setPending(!enabled); setIssue('');
    try {
      if (record) await removeDevice(record.token);
      else if (setup) await enablePush(account, vaultId, setup, record);
    } catch (reason) {
      if (mounted.current) setIssue(reason instanceof Error && reason.name !== 'NotAllowedError'
        ? reason.message : 'Allow notifications in your browser settings to enable them.');
    } finally {
      const current = await readDevice().catch(() => undefined);
      if (mounted.current) { setRecord(current?.vaultId === vaultId ? current : undefined); setPending(null); }
    }
  }
  const description = !available ? 'Use a browser with Web Push. On iPhone or iPad, open MeShell from the Home Screen.' :
      blocked ? 'Notifications are blocked in your browser settings.' :
      record && !record.active ? 'Registration is pending. Reconnect to finish or turn this off.' :
      'Get a private alert for messages sent from MeShell. The notification service receives your public key and this browser’s push subscription.';
  return <div>
    <DevicePreference title="Enable notifications on this device" description={description} checked={pending ?? enabled}
      disabled={pending !== null || (!enabled && (!available || !setup || blocked))} onChange={toggle} />
    {issue && !blocked && <small className={styles.preferenceStatus} role="status">{issue} {available && !setup && <button type="button" className={styles.secondaryAction}
      onClick={() => { setIssue(''); setAttempt(n => n + 1); }}>Retry notifications</button>}</small>}
  </div>;
}
