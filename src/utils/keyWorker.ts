import type { KeyJob, KeyResult } from '../workers/keyVault.worker';

export function processKey(job: KeyJob, signal: AbortSignal): Promise<{ sk: Uint8Array; encrypted: string }> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('../workers/keyVault.worker.ts', import.meta.url), { type: 'module' });
    function stop() { worker.terminate(); signal.removeEventListener('abort', cancel); }
    function cancel() { stop(); reject(new DOMException('Session closed', 'AbortError')); }
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<KeyResult>) => {
      stop();
      if ('error' in data) reject(Error(data.error === 'pin' ? 'That PIN didn’t unlock this account. Try again.' : 'The saved key could not be verified.'));
      else resolve(data);
    };
    worker.onerror = () => { stop(); reject(Error('Key protection could not finish on this device. Try again.')); };
    worker.postMessage(job);
  });
}
