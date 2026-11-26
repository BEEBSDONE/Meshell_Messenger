import { lazy, Suspense, useSyncExternalStore } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import LoginPage from './components/LoginPage';
import PinPage from './components/PinPage';
import { refreshSession, sessionSnapshot, subscribeSession } from './utils/session';

const ChatPage = lazy(() => import('./components/ChatPage'));

export default function App() {
  const session = useSyncExternalStore(subscribeSession, sessionSnapshot);
  if (session.mode === 'loading') return <p role="status">Opening MeShell…</p>;
  if (session.mode === 'error') return <main><p role="alert">{session.message}</p><button onClick={refreshSession}>Retry</button></main>;
  const path = session.mode === 'open' ? '/chat' : session.mode === 'empty' ? '/' : '/lock';
  return <BrowserRouter><Routes>
    <Route path={path} element={session.mode === 'open' ?
      <Suspense fallback={<p role="status">Opening chats…</p>}><ChatPage key={session.vault.id} keys={session.account} vaultId={session.vault.id} justRegistered={session.fresh} /></Suspense> :
      session.mode === 'locked' || session.mode === 'setup' ?
        <PinPage key={session.mode} setup={session.mode === 'setup'} legacy={session.mode === 'setup' && session.source === 'legacy'} /> :
        <LoginPage />} />
    <Route path="*" element={<Navigate to={path} replace />} />
  </Routes></BrowserRouter>;
}
