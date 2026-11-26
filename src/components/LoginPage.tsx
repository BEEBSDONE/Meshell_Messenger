import { useState } from 'react';
import { beginSetup } from '../utils/session';
import { getDarkMode } from '../utils/storage';
import styles from './LoginPage.module.css';
import logo from '../assets/MeShell_Logo.svg';

export default function LoginPage() {
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState('');
  function login() {
    try { beginSetup(nsec); }
    catch { setError('Enter a valid nsec to sign in.'); }
  }
  return <main className={styles.loginPage + (getDarkMode() ? ' darkMode' : '')}>
    <img src={logo} alt="MeShell" className={styles.logo} />
    <form className={styles.loginBox} onSubmit={e => { e.preventDefault(); login(); }}>
      <h2>Login</h2>
      <input type="password" aria-label="Private key" autoComplete="off" spellCheck={false} className={styles.input}
        value={nsec} onChange={e => setNsec(e.target.value)} placeholder="Enter your nsec" />
      {error && <p role="alert">{error}</p>}
      <button className={styles.loginButton}>Login</button>
      <button type="button" className={styles.registerButton} onClick={() => beginSetup()}>Register</button>
    </form>
  </main>;
}
