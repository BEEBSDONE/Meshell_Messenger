import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import { getNsec } from './utils/storage';

const RequireAuth: React.FC<{ children: JSX.Element }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasNsec, setHasNsec] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      try {
        const nsec = await getNsec();
        if (mounted) {
          setHasNsec(!!nsec);
          console.log('Auth check - nsec present:', !!nsec);
        }
      } catch (error) {
        console.error('Error checking auth:', error);
        if (mounted) {
          setHasNsec(false);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    checkAuth();

    // Set up an interval to periodically check for nsec
    const intervalId = setInterval(checkAuth, 1000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [location.pathname]); // Re-run when location changes

  if (isLoading) {
    return <div>Loading...</div>;
  }

  console.log('Current path:', location.pathname, 'Has nsec:', hasNsec);

  // If nsec is present, redirect to /chat if the user is trying to access /
  if (hasNsec && location.pathname === '/') {
    console.log('Redirecting to /chat');
    return <Navigate to="/chat" replace />;
  }

  // If nsec is not present, redirect to / if the user tries to access /chat
  if (!hasNsec && location.pathname === '/chat') {
    console.log('Redirecting to /');
    return <Navigate to="/" replace />;
  }

  // Render the requested page if no redirection is needed
  return children;
};

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <LoginPage />
            </RequireAuth>
          }
        />
        <Route
          path="/chat"
          element={
            <RequireAuth>
              <ChatPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Router>
  );
};

export default App;

