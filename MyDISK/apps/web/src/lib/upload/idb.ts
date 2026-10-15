/**
 * 上传队列的本地持久化（IndexedDB 库 `mydisk-upload`）。
 *
 * - `sessions`：会话元数据（keyPath `fingerprint`），刷新后重建队列与对账依据。
 * - `handles`：A 级载体（FileSystemFileHandle），仅 Chromium。
 * - `blobs`：B 级载体（文件副本 Blob），本期默认走 C 级不落盘。
 *
 * 全部接口在 SSR（无 `indexedDB`）下安全降级为空结果 / 空操作，不抛错。
 */
export const DB_NAME = "mydisk-upload";
export const DB_VERSION = 1;
export const SESSIONS = "sessions";
export const HANDLES = "handles";
export const BLOBS = "blobs";

export type UploadCarrier = "fsa" | "blob" | "none";

export type PersistedSession = {
  fingerprint: string;
  uploadId: string | null;
  name: string;
  size: number;
  mtime: number;
  mime: string | null;
  parentId: string | null;
  relativePath: string | null;
  carrier: UploadCarrier;
  state: string;
  updatedAt: number;
};

export type PersistedHandle = {
  fingerprint: string;
  handle: FileSystemFileHandle;
};

export type PersistedBlob = {
  fingerprint: string;
  blob: Blob;
};

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** 打开（或惰性创建）上传库；不可用时返回 `null`。 */
export function openUploadDb(): Promise<IDBDatabase | null> {
  if (!hasIdb()) {
    return Promise.resolve(null);
  }
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: "fingerprint" });
      }
      if (!db.objectStoreNames.contains(HANDLES)) {
        db.createObjectStore(HANDLES, { keyPath: "fingerprint" });
      }
      if (!db.objectStoreNames.contains(BLOBS)) {
        db.createObjectStore(BLOBS, { keyPath: "fingerprint" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openUploadDb();
  if (!db) {
    return null;
  }
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(storeName, mode);
      const request = executor(tx.objectStore(storeName));
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const result = await run<T[]>(
    storeName,
    "readonly",
    (store) => store.getAll() as IDBRequest<T[]>,
  );
  return result ?? [];
}

export function putSession(session: PersistedSession): Promise<unknown> {
  return run(SESSIONS, "readwrite", (store) => store.put(session));
}

export function getSession(fingerprint: string): Promise<PersistedSession | null> {
  return run<PersistedSession>(SESSIONS, "readonly", (store) => store.get(fingerprint));
}

export function deleteSession(fingerprint: string): Promise<unknown> {
  return run(SESSIONS, "readwrite", (store) => store.delete(fingerprint));
}

export function putHandle(handle: PersistedHandle): Promise<unknown> {
  return run(HANDLES, "readwrite", (store) => store.put(handle));
}

export function getHandle(fingerprint: string): Promise<PersistedHandle | null> {
  return run<PersistedHandle>(HANDLES, "readonly", (store) => store.get(fingerprint));
}

export function deleteHandle(fingerprint: string): Promise<unknown> {
  return run(HANDLES, "readwrite", (store) => store.delete(fingerprint));
}

export function putBlob(blob: PersistedBlob): Promise<unknown> {
  return run(BLOBS, "readwrite", (store) => store.put(blob));
}

export function getBlob(fingerprint: string): Promise<PersistedBlob | null> {
  return run<PersistedBlob>(BLOBS, "readonly", (store) => store.get(fingerprint));
}

export function deleteBlob(fingerprint: string): Promise<unknown> {
  return run(BLOBS, "readwrite", (store) => store.delete(fingerprint));
}

export function listSessions(): Promise<PersistedSession[]> {
  if (!hasIdb()) {
    return Promise.resolve([]);
  }
  return readAll<PersistedSession>(SESSIONS);
}
