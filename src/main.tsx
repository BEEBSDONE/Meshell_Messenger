import ReactDOM from 'react-dom/client';
import App from './App';
import './global.css';
import { registerSW } from 'virtual:pwa-register';

import { startSession } from './utils/session';

startSession();

// Register the service worker
registerSW({
  onNeedRefresh() {
    console.log('A new version of the app is available. Please refresh.');
  },
  onOfflineReady() {
    console.log('The app is ready to work offline.');
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);

