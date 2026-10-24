// The player's gallery, stored in the browser (IndexedDB) on this device.
//
// puzzles:      one record per finished puzzle, including its photo as a JPEG blob.
// achievements: { id, earnedAt } once earned. Kept separately so removing a puzzle
//               from the gallery never takes an achievement away.
// saved:        the unfinished puzzle, so it can be continued later: 'current' holds the
//               layout and clock, 'current-photo' the photo (written once per game).

const DB_NAME = 'puzzle-table';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const stores = db.objectStoreNames;
      if (!stores.contains('puzzles')) db.createObjectStore('puzzles', { keyPath: 'id', autoIncrement: true });
      if (!stores.contains('achievements')) db.createObjectStore('achievements', { keyPath: 'id' });
      if (!stores.contains('saved')) db.createObjectStore('saved', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// Runs fn(store) in a transaction and resolves with the last request's result once it commits.
async function withStore(name, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const savePuzzle = (record) => withStore('puzzles', 'readwrite', (s) => s.add(record));
export const listPuzzles = () => withStore('puzzles', 'readonly', (s) => s.getAll());
export const deletePuzzle = (id) => withStore('puzzles', 'readwrite', (s) => s.delete(id));

export const listAchievements = () => withStore('achievements', 'readonly', (s) => s.getAll());
export const saveAchievements = (list) => withStore('achievements', 'readwrite', (s) => {
  let last;
  for (const item of list) last = s.put(item);
  return last;
});

// The unfinished puzzle (one at a time).
export const saveProgress = (record) => withStore('saved', 'readwrite', (s) => s.put({ ...record, id: 'current' }));
export const saveProgressPhoto = (record) => withStore('saved', 'readwrite', (s) => s.put({ ...record, id: 'current-photo' }));
export const loadProgress = async () => {
  const [meta, photo] = await Promise.all([
    withStore('saved', 'readonly', (s) => s.get('current')),
    withStore('saved', 'readonly', (s) => s.get('current-photo')),
  ]);
  return meta && photo ? { ...meta, photo } : null;
};
export const clearProgress = () => withStore('saved', 'readwrite', (s) => s.clear());
