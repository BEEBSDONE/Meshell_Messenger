import { bech32 } from '@scure/base';
import { getPublicKey } from 'nostr-tools/pure';
import { encrypt, decrypt } from 'nostr-tools/nip49';

export type KeyJob = { pin: string; pk: string } & (
  { operation: 'protect'; sk: Uint8Array; fresh: boolean } | { operation: 'unlock'; encrypted: string }
);
export type KeyResult = { sk: Uint8Array; encrypted: string } | { error: 'pin' | 'record' };

self.onmessage = ({ data }: MessageEvent<KeyJob>) => {
  let failure: 'pin' | 'record' = 'record';
  let secret: Uint8Array | undefined;
  try {
    if (!/^\d{6}$/.test(data.pin)) throw Error();
    const encrypted = data.operation === 'protect' ? encrypt(data.sk, data.pin, 16, data.fresh ? 1 : 0) : data.encrypted;
    // Only accept the bounded scrypt cost and format this version writes.
    const { prefix, bytes } = bech32.decodeToBytes(encrypted, 200);
    if (prefix !== 'ncryptsec' || bytes.length !== 91 || bytes[0] !== 2 || bytes[1] !== 16) throw Error();
    if (data.operation === 'unlock') failure = 'pin';
    secret = decrypt(encrypted, data.pin);
    failure = 'record';
    if (getPublicKey(secret) !== data.pk ||
      (data.operation === 'protect' && !secret.every((value, i) => value === data.sk[i]))) throw Error();
    self.postMessage({ sk: secret, encrypted } satisfies KeyResult);
  } catch { self.postMessage({ error: failure } satisfies KeyResult); }
  finally { secret?.fill(0); if (data.operation === 'protect') data.sk.fill(0); self.close(); }
};
