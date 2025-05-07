import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify'; // Import DOMPurify
import { storeNsec, getDarkMode } from '../utils/storage'; // Added getDarkMode for dark mode persistence
import { decodeNsec } from '../utils/nostr';
import { generateSecretKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19'; // Import nip19 for encoding
import styles from './LoginPage.module.css';
import MeShellLogo from '../assets/MeShell_Logo.svg'; // Import the logo

const LoginPage: React.FC = () => {
  const [nsecInput, setNsecInput] = useState('');
  const [darkMode, setDarkMode] = useState(false); // Dark mode state
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const savedDarkMode = getDarkMode();
    if (savedDarkMode !== null) {
      setDarkMode(savedDarkMode); // Initialize dark mode based on saved preference
    }
  }, []);

  const handleLogin = async () => {
    const sanitizedNsec = DOMPurify.sanitize(nsecInput.trim()); // Sanitize nsec input
    if (!sanitizedNsec) {
      alert('Please enter your nsec.');
      return;
    }

    setIsLoading(true);
    try {
      decodeNsec(sanitizedNsec); // Verify nsec is valid
      await storeNsec(sanitizedNsec); // Wait for nsec to be stored in IndexedDB
      navigate('/chat', { replace: true });
    } catch (error) {
      console.error('Error decoding nsec:', error);
      alert('Invalid nsec. Please enter a valid nsec.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    setIsLoading(true);
    try {
      const sk = generateSecretKey(); // Generate a new secret key
      const nsec = nip19.nsecEncode(sk); // Encode it as nsec
      await storeNsec(nsec); // Wait for nsec to be stored in IndexedDB
      navigate('/chat', { replace: true }); // Redirect to chat page
    } catch (error) {
      console.error('Error during registration:', error);
      alert('Error during registration. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`${styles.loginPage} ${darkMode ? 'darkMode' : ''}`}>
      {/* Logo */}
      <img src={MeShellLogo} alt="MeShell Logo" className={styles.logo} />

      <div className={styles.loginBox}>
        <h2>Login</h2>
        <input
          type="text"
          value={nsecInput}
          onChange={(e) => setNsecInput(e.target.value)}
          placeholder="Enter your nsec"
          className={styles.input}
          disabled={isLoading}
        />
        <button 
          onClick={handleLogin} 
          className={styles.loginButton}
          disabled={isLoading}
        >
          {isLoading ? 'Logging in...' : 'Login'}
        </button>
        <button 
          onClick={handleRegister} 
          className={styles.registerButton}
          disabled={isLoading}
        >
          {isLoading ? 'Registering...' : 'Register'}
        </button>
      </div>
    </div>
  );
};

export default LoginPage;

