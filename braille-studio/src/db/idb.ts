/**
 * IndexedDB 持久化：工程保存在浏览器本地，不上传任何云服务。
 */

import type { ProjectDoc } from "../model/types";

const DB_NAME = "braille-studio";
const STORE = "projects";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = <T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function saveProject(doc: ProjectDoc): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, "readwrite", (s) => s.put({ ...doc, updatedAt: Date.now() }));
  } finally {
    db.close();
  }
}

export async function loadProject(id: string): Promise<ProjectDoc | undefined> {
  const db = await openDb();
  try {
    return await tx(db, "readonly", (s) => s.get(id) as IDBRequest<ProjectDoc | undefined>);
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const db = await openDb();
  try {
    const all = await tx(db, "readonly", (s) => s.getAll() as IDBRequest<ProjectDoc[]>);
    return all
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, "readwrite", (s) => s.delete(id));
  } finally {
    db.close();
  }
}
