/**
 * Local persistence. Everything here is IndexedDB on the user's own machine —
 * there is no server, no sync and no telemetry.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Asset, EditorDocument, PersistedSession } from '../../types/document';

export interface RecentEntry {
  id: string;
  name: string;
  pageCount: number;
  openedAt: number;
  /** Data URL of the first page, small enough to keep around. */
  thumbnail?: string;
}

export interface StoredSignature {
  id: string;
  name: string;
  asset: Asset;
  createdAt: number;
}

interface PaperboxDb extends DBSchema {
  sessions: { key: string; value: PersistedSession };
  recent: { key: string; value: RecentEntry; indexes: { openedAt: number } };
  signatures: { key: string; value: StoredSignature };
  prefs: { key: string; value: unknown };
}

const DB_NAME = 'paperbox';
const DB_VERSION = 1;
const CURRENT_SESSION = 'current';

let dbPromise: Promise<IDBPDatabase<PaperboxDb>> | null = null;

const getDb = (): Promise<IDBPDatabase<PaperboxDb>> => {
  dbPromise ??= openDB<PaperboxDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recent')) {
        const store = db.createObjectStore('recent', { keyPath: 'id' });
        store.createIndex('openedAt', 'openedAt');
      }
      if (!db.objectStoreNames.contains('signatures')) db.createObjectStore('signatures', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs');
    },
  });
  return dbPromise;
};

export const storageAvailable = (): boolean =>
  typeof indexedDB !== 'undefined' && indexedDB !== null;

export async function saveSession(doc: EditorDocument): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.put('sessions', { id: CURRENT_SESSION, document: doc, savedAt: Date.now() });
}

export async function loadSession(): Promise<PersistedSession | undefined> {
  if (!storageAvailable()) return undefined;
  const db = await getDb();
  return db.get('sessions', CURRENT_SESSION);
}

export async function clearSession(): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.delete('sessions', CURRENT_SESSION);
}

export async function putRecent(entry: RecentEntry): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.put('recent', entry);
  // Keep the list short; these carry thumbnails.
  const all = await db.getAllFromIndex('recent', 'openedAt');
  const excess = all.slice(0, Math.max(0, all.length - 12));
  await Promise.all(excess.map((item) => db.delete('recent', item.id)));
}

export async function listRecent(): Promise<RecentEntry[]> {
  if (!storageAvailable()) return [];
  const db = await getDb();
  const all = await db.getAllFromIndex('recent', 'openedAt');
  return all.reverse();
}

export async function clearRecent(): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.clear('recent');
}

export async function listSignatures(): Promise<StoredSignature[]> {
  if (!storageAvailable()) return [];
  const db = await getDb();
  const all = await db.getAll('signatures');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSignature(signature: StoredSignature): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.put('signatures', signature);
}

export async function deleteSignature(id: string): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.delete('signatures', id);
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  if (!storageAvailable()) return fallback;
  const db = await getDb();
  const value = (await db.get('prefs', key)) as T | undefined;
  return value === undefined ? fallback : value;
}

export async function setPref(key: string, value: unknown): Promise<void> {
  if (!storageAvailable()) return;
  const db = await getDb();
  await db.put('prefs', value, key);
}

/** Rough idea of how much room the browser is giving us. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
