// IndexedDB 儲存：所有相同資料只留喺部手機
const DB_NAME = 'closet';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('created', 'created');
      }
      if (!db.objectStoreNames.contains('outfits')) {
        db.createObjectStore('outfits', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function getAll(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, id) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).get(id));
}
export function put(store, value) {
  return tx(store, 'readwrite', (s) => s.put(value));
}
export function del(store, id) {
  return tx(store, 'readwrite', (s) => s.delete(id));
}
export function clear(store) {
  return tx(store, 'readwrite', (s) => s.clear());
}

// 細設定（例如 API key）都放 IndexedDB，唔放程式入面
export async function kvGet(key) {
  const db = await open();
  return reqP(db.transaction('kv').objectStore('kv').get(key));
}
export function kvSet(key, value) {
  return tx('kv', 'readwrite', (s) => s.put(value, key));
}
export function kvDel(key) {
  return tx('kv', 'readwrite', (s) => s.delete(key));
}
