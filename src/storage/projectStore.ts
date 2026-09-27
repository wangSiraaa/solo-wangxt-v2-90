/**
 * IndexedDB 工程存储：纯本地，无任何网络/云同步。
 */
import type { Project } from '../types';

const DB_NAME = 'tactile-publishing-studio';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveProject(project: Project): Promise<void> {
  const record: Project = { ...project, updatedAt: Date.now() };
  await tx('readwrite', (s) => s.put(record));
}

export async function loadAllProjects(): Promise<Project[]> {
  return tx('readonly', (s) => s.getAll());
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return tx('readonly', (s) => s.get(id));
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}
