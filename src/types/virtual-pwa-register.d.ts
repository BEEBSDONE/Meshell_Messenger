declare module 'virtual:pwa-register' {
  interface RegisterSWOptions {
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
  }

  export function registerSW(options?: RegisterSWOptions): void;
} 