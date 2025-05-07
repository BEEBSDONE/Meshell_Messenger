import { openDB } from 'idb'; // Using idb library for IndexedDB interactions

// Database and store names
const DB_NAME = 'SecureStorage';
const STORE_NAME = 'nsecStore';

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

// Function to store encrypted nsec in IndexedDB
export async function storeEncryptedNsec(encryptedNsec: string): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, encryptedNsec, 'nsec');
}

// Function to retrieve encrypted nsec from IndexedDB
export async function getEncryptedNsec(): Promise<string | null> {
  const db = await getDB();
  return db.get(STORE_NAME, 'nsec');
}

// Function to remove encrypted nsec from IndexedDB
export async function clearNsec(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, 'nsec');
}

