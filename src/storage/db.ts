/**
 * 人情账 · IndexedDB 封装
 *
 * 只用两个对象仓：
 *   kv      —— 账本正文（一条记录）、加密开关、校验信息
 *   backups —— 自动备份快照，保留最近 20 份
 *
 * 为什么是「单文档」而不是关系表：
 *   家庭账本的量级是几百到几万条，整库读进内存完全无压力；
 *   而备份、加密、恢复、导出全都是「整体操作」，
 *   用单文档做，这四件事各自只要一行代码。
 *   代价是不支持并发多端写入 —— 而我们本来就不做云同步。
 */

const DB_NAME = 'renqing-ledger';
const DB_VERSION = 1;

export const STORE_KV = 'kv';
export const STORE_BACKUPS = 'backups';

/** 账本正文的键 */
export const KEY_LEDGER = 'ledger';
/** 加密配置的键：{ enabled, kdf, iv } */
export const KEY_LOCK = 'lock';

export interface BackupRecord {
  id: string;
  created_at: string;
  /** 明文 JSON 大小（字节），用于展示 */
  size: number;
  /** 备份内容，已加密时为 CipherBlob 的 JSON 字符串 */
  payload: string;
  encrypted: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个环境不支持 IndexedDB'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
      if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
        const store = db.createObjectStore(STORE_BACKUPS, { keyPath: 'id' });
        store.createIndex('created_at', 'created_at');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开数据库失败'));
  });

  return dbPromise;
}

/**
 * 跑一次事务。
 * 这里刻意用裸的 IDBRequest（等价于 IDBRequest<any>），
 * 因为 IDBRequest<T> 在 T 上是变型的，写 IDBRequest<unknown> 会让所有
 * put/delete（返回 IDBValidKey / undefined）都报错。返回类型由调用方用泛型指定。
 */
function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('数据库操作失败'));
      }),
  );
}

/* ------------------------------------------------------------------ KV */

export function kvGet<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>(STORE_KV, 'readonly', (s) => s.get(key));
}

export function kvSet(key: string, value: unknown): Promise<void> {
  return tx<void>(STORE_KV, 'readwrite', (s) => s.put(value, key));
}

export function kvDelete(key: string): Promise<void> {
  return tx<void>(STORE_KV, 'readwrite', (s) => s.delete(key));
}

export function kvKeys(): Promise<string[]> {
  return tx<IDBValidKey[]>(STORE_KV, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  );
}

/* ------------------------------------------------------------------ 备份 */

export function putBackup(rec: BackupRecord): Promise<void> {
  return tx<void>(STORE_BACKUPS, 'readwrite', (s) => s.put(rec));
}

export function listBackups(): Promise<BackupRecord[]> {
  return tx<BackupRecord[]>(STORE_BACKUPS, 'readonly', (s) => s.getAll()).then((all) =>
    all.sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
}

export function getBackup(id: string): Promise<BackupRecord | undefined> {
  return tx<BackupRecord | undefined>(STORE_BACKUPS, 'readonly', (s) => s.get(id));
}

export function deleteBackup(id: string): Promise<void> {
  return tx<void>(STORE_BACKUPS, 'readwrite', (s) => s.delete(id));
}

/* ------------------------------------------------------------------ 维护 */

/** 清空整个数据库（「彻底删除所有数据」用） */
export async function destroyDB(): Promise<void> {
  const db = await openDB();
  db.close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('删除数据库失败'));
    req.onblocked = () => resolve(); // 有别的标签页开着也继续
  });
}

/** 估算占用空间（浏览器支持时） */
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}
