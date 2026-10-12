/**
 * The queue (including original and result blobs) lives in IndexedDB, not
 * chrome.storage: it can hold several full-size images, and both the popup
 * and the side panel (same extension origin) can read it. Blobs are stored
 * directly via structured clone.
 */
import type { ItemOverrides } from '../core/settings';

export type ItemStatus = 'queued' | 'converting' | 'done' | 'error';

export interface QueueRecord {
  id: string;
  name: string;
  ext: string;
  sizeBytes: number;
  status: ItemStatus;
  error: string;
  resultName: string;
  resultSize: number;
  overrides: ItemOverrides;
  originalBlob: Blob;
  resultBlobStored: Blob | null;
  /** Insertion time; v1.0 records lack it and sort after by id. */
  addedAt?: number;
}

export interface QueueRepo {
  put(record: QueueRecord): Promise<void>;
  delete(id: string): Promise<void>;
  deleteMany(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  getAll(): Promise<QueueRecord[]>;
}

const DB_NAME = 'image-converter-db';
const DB_VERSION = 1;
const STORE = 'queue';

export function sortRecords(records: QueueRecord[]): QueueRecord[] {
  return records.slice().sort((a, b) => (a.addedAt ?? Infinity) - (b.addedAt ?? Infinity) || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

export function createQueueRepo(idb: IDBFactory = indexedDB): QueueRepo {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  async function tx(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      fn(t.objectStore(STORE));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    put: (record) => tx('readwrite', (s) => s.put(record)),
    delete: (id) => tx('readwrite', (s) => s.delete(id)),
    deleteMany: (ids) => tx('readwrite', (s) => ids.forEach((id) => s.delete(id))),
    clear: () => tx('readwrite', (s) => s.clear()),
    async getAll() {
      const db = await open();
      const records = await new Promise<QueueRecord[]>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as QueueRecord[]) || []);
        req.onerror = () => reject(req.error);
      });
      return sortRecords(records);
    },
  };
}
