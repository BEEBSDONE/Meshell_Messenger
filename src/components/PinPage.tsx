import { useLayoutEffect, useRef, useState } from 'react';
import { beginSetup, enterPin, refreshSession } from '../utils/session';
import { getDarkMode } from '../utils/storage';
import logo from '../assets/MeShell_Logo.svg';
import styles from './PinPage.module.css';

const numbers = Array.from({ length: 10 }, (_, i) => String(i));
function shuffled(previous?: string[]) {
  let next: string[];
  do {
    next = [...numbers];
    for (let i = next.length - 1; i > 0; i--) {
      const bound = i + 1, limit = 256 - 256 % bound;
      let value;
      do { value = crypto.getRandomValues(new Uint8Array(1))[0]; } while (value >= limit);
      const j = value % bound;
      [next[i], next[j]] = [next[j], next[i]];
    }
  } while (previous && next.some((digit, i) => digit === previous[i]));
  return next;
}

export default function PinPage({ setup, legacy }: { setup: boolean; legacy: boolean }) {
  const [layout, setLayout] = useState(() => shuffled());
  const entry = useRef('');
  const first = useRef('');
  const [count, setCount] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [dark] = useState(getDarkMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [backup, setBackup] = useState('');
  const working = useRef(false);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; entry.current = ''; first.current = ''; };
  }, []);
  function edit(value: string) { entry.current = value; setCount(value.length); }

  function press(digit: string) {
    if (working.current) return;
    setError('');
    setLayout(previous => shuffled(previous));
    const value = entry.current + digit;
    if (value.length < 6) { edit(value); return; }
    edit('');
    if (setup && !first.current) { first.current = value; setConfirming(true); return; }
    const matches = value === first.current;
    first.current = ''; setConfirming(false);
    if (setup && !matches) { setError('The PINs didn’t match. Enter your new PIN again.'); return; }
    working.current = true; setBusy(true);
    void enterPin(value).catch(reason => {
      if (active.current) setError(reason instanceof Error ? reason.message : 'Please try again.');
    }).finally(() => { working.current = false; if (active.current) setBusy(false); });
  }
  useLayoutEffect(() => {
    function key(e: KeyboardEvent) {
      if (recovering || busy || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); edit(entry.current.slice(0, -1)); }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function recover() {
    try { if (!backup.trim()) throw Error(); beginSetup(backup.trim()); }
    catch { setError('Enter the backup nsec for this account.'); }
  }
  return <main className={styles.screen + (dark ? ' darkMode' : '')}>
    <section aria-labelledby="pin-title" className={styles.panel}>
      <img src={logo} alt="MeShell" className={styles.logo} />
      <h1 id="pin-title">{recovering ? 'Use your backup key' : setup ? confirming ? 'Confirm your PIN' : 'Create your PIN' : 'Unlock MeShell'}</h1>
      {recovering ? <form onSubmit={e => { e.preventDefault(); recover(); }}>
        <p>Enter your nsec to set a new PIN for this account.</p>
        <input type="password" aria-label="Backup nsec" placeholder="Enter your backup nsec" autoComplete="off" spellCheck={false} value={backup} onChange={e => setBackup(e.target.value)} />
        <button className={styles.primary}>Continue</button>
        <button type="button" className={styles.link} onClick={() => { setRecovering(false); setBackup(''); setError(''); }}>Back to PIN</button>
      </form> : <>
        <p>{setup ? confirming ? 'Enter the same six digits again.' : legacy ? 'Protect your existing nsec on this device with six digits.' :
          'Choose six digits to protect your nsec on this device.' : 'Enter your six-digit PIN to open your chats.'}</p>
        <div className={styles.dots} role="img" aria-label={count + ' of 6 digits entered'}>
          {Array.from({ length: 6 }, (_, i) => <i key={i} data-filled={i < count} />)}
        </div>
        <div className={styles.pad} role="group" aria-label="PIN keypad">
          {layout.map((digit, i) => <button type="button" key={i} disabled={busy} onClick={() => press(digit)}>{digit}</button>)}
          <button type="button" className={styles.erase} aria-label="Delete last digit" disabled={busy || !count} onClick={() => edit(entry.current.slice(0, -1))}>⌫</button>
        </div>
        {setup && !confirming && !busy && <small>Keep a private backup of your nsec to recover access if you forget your PIN.</small>}
        {busy && <p role="status">{setup ? 'Protecting and verifying your key…' : 'Unlocking…'}</p>}
        {!setup && !busy && <button className={styles.link} onClick={() => { setRecovering(true); edit(''); setError(''); }}>Use backup nsec</button>}
        {setup && !legacy && !busy && <button className={styles.link} onClick={refreshSession}>Cancel</button>}
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  </main>;
}
