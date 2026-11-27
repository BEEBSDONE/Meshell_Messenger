import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

// https://vitejs.dev/config/
const hasLocalCertificate = fs.existsSync('localhost+2-key.pem') && fs.existsSync('localhost+2.pem');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { importScripts: ['/push-worker.js'], navigateFallbackDenylist: [/^\/api\/push\//] },
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: 'MeShell Messenger',
        short_name: 'MeShell',
        description: 'A secure Nostr-based messaging client',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        icons: [
          {
            src: '/vite.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
  server: command === 'serve' ? {
    host: hasLocalCertificate ? true : 'localhost',
    port: 5173,
    https: hasLocalCertificate ? {
      key: fs.readFileSync(path.resolve(__dirname, 'localhost+2-key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, 'localhost+2.pem')),
    } : undefined,
  } : undefined,
}));

