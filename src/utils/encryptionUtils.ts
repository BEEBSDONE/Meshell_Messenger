export async function encryptData(data: string, passphrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const encodedPassphrase = encoder.encode(passphrase);
  const key = await crypto.subtle.importKey(
    "raw",
    encodedPassphrase,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("unique-salt"), // Use a unique salt here
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedData = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    derivedKey,
    encoder.encode(data)
  );

  const buffer = new Uint8Array(iv.length + encryptedData.byteLength);
  buffer.set(iv);
  buffer.set(new Uint8Array(encryptedData), iv.length);

  return btoa(String.fromCharCode(...buffer));
}

export async function decryptData(encryptedData: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);

  const encoder = new TextEncoder();
  const encodedPassphrase = encoder.encode(passphrase);
  const key = await crypto.subtle.importKey(
    "raw",
    encodedPassphrase,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("unique-salt"), // Use the same unique salt as in encryption
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    derivedKey,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

