// Обёртка над IndexedDB: 4 стора, promise-based API
const DB_NAME = 'trenazhorka-db';
const DB_VERSION = 1;
export const STORES = ['exercises', 'workouts', 'analyses', 'records'];

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => resolve(rq ? rq.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  getAll: (store) => tx(store, 'readonly', st => st.getAll()),
  get: (store, id) => tx(store, 'readonly', st => st.get(id)),
  put: (store, obj) => tx(store, 'readwrite', st => st.put(obj)).then(() => obj),
  delete: (store, id) => tx(store, 'readwrite', st => st.delete(id)),
};

/** полный экспорт для бэкапа */
export async function exportAll() {
  const data = { app: 'trenazhorka', version: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) data[s] = await db.getAll(s);
  return data;
}

/** импорт: добавляем/заменяем по id (merge) */
export async function importAll(data) {
  let count = 0;
  for (const s of STORES) {
    const arr = Array.isArray(data && data[s]) ? data[s] : [];
    for (const item of arr) {
      if (item && item.id) { await db.put(s, item); count++; }
    }
  }
  return count;
}
