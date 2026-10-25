// The player's gallery, achievements and unfinished puzzle.
//
// Signed out, everything lives in this browser (IndexedDB). Signed in, everything lives in the
// player's account on the server, so it follows them to any device; on signing in, anything
// played here as a guest is moved into the account and removed from the browser, so the next
// person using this device doesn't see it.
//
// Browser stores:
// puzzles:      one record per finished puzzle, including its photo as a JPEG blob.
// achievements: { id, earnedAt } once earned. Kept separately so removing a puzzle
//               from the gallery never takes an achievement away.
// saved:        the unfinished puzzle, so it can be continued later: 'current' holds the
//               layout and clock, 'current-photo' the photo (written once per game).
//               'recovery' / 'recovery-photo': a copy kept here when saving to the account
//               failed, so nothing is lost; it's offered back if it's newer than the account's.

import { api, apiBlob, blobToBase64 } from './api.js';

const DB_NAME = 'puzzle-table';
const DB_VERSION = 2;

let dbPromise = null;
let user = null; // the signed-in player, or null

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

// Writes several records in one transaction: all of them are stored, or none.
async function putAll(name, records) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    for (const record of records) store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
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

const local = {
  listPuzzles: () => withStore('puzzles', 'readonly', (s) => s.getAll()),
  deletePuzzle: (id) => withStore('puzzles', 'readwrite', (s) => s.delete(id)),
  listAchievements: () => withStore('achievements', 'readonly', (s) => s.getAll()),
  clearAchievements: () => withStore('achievements', 'readwrite', (s) => s.clear()),
  loadProgress: async () => {
    const [meta, photo] = await Promise.all([
      withStore('saved', 'readonly', (s) => s.get('current')),
      withStore('saved', 'readonly', (s) => s.get('current-photo')),
    ]);
    return meta && photo ? { ...meta, photo } : null;
  },
  clearProgress: () => withStore('saved', 'readwrite', (s) => {
    s.delete('current');
    return s.delete('current-photo');
  }),
  loadRecovery: async () => {
    const [meta, photo] = await Promise.all([
      withStore('saved', 'readonly', (s) => s.get('recovery')),
      withStore('saved', 'readonly', (s) => s.get('recovery-photo')),
    ]);
    return meta && photo && meta.userId === user?.id ? { ...meta, photo } : null;
  },
};

const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// The finished-puzzle details the server keeps (the picture goes separately).
function puzzleDetails(record) {
  const { image, id, uid, ...details } = record;
  return details;
}

async function uploadPuzzle(record, uid) {
  await api('gallery/add', { uid, puzzle: puzzleDetails(record), image: await blobToBase64(record.image) });
}

/* ---------- Signing in and out ---------- */

export function setUser(next) {
  user = next;
}

export const isSignedIn = () => Boolean(user);

// Moves what was played here as a guest into the account, then removes it from this browser.
// Each item is removed only after it reached the server, so nothing is lost if this stops halfway.
export async function moveGuestDataToAccount() {
  if (!user) return;
  for (const record of await local.listPuzzles()) {
    await uploadPuzzle(record, record.uid ?? `guest-${record.createdAt}-${record.id}`);
    await local.deletePuzzle(record.id);
  }
  const earned = await local.listAchievements();
  if (earned.length) {
    await api('achievements', { achievements: earned });
    await local.clearAchievements();
  }
  const saved = await local.loadProgress();
  if (saved) {
    const theirs = await api('progress').then((r) => r.progress, () => null);
    if (!theirs || (theirs.savedAt ?? 0) < (saved.savedAt ?? 0)) {
      const { photo, id, ...meta } = saved;
      await uploadProgressFull(photo, meta);
    }
    await local.clearProgress();
  }
}

/* ---------- Finished puzzles ---------- */

export async function savePuzzle(record) {
  const uid = newUid();
  if (user) return uploadPuzzle(record, uid);
  return withStore('puzzles', 'readwrite', (s) => s.add({ ...record, uid }));
}

// Account puzzles come without their picture; `imageUrl` loads it (only for this player).
export async function listPuzzles() {
  if (!user) return local.listPuzzles();
  const { puzzles } = await api('gallery');
  return puzzles.map((p) => ({ ...p, imageUrl: `/api/gallery/${p.id}/image` }));
}

export async function deletePuzzle(id) {
  if (user) return api('gallery/delete', { id });
  return local.deletePuzzle(id);
}

// A finished puzzle's picture as a Blob, wherever it's stored.
export async function puzzleImage(puzzle) {
  return puzzle.image ?? apiBlob(puzzle.imageUrl.replace(/^\/api\//, ''));
}

/* ---------- Achievements ---------- */

export async function listAchievements() {
  if (!user) return local.listAchievements();
  return (await api('achievements')).achievements;
}

export async function saveAchievements(list) {
  if (user) return api('achievements', { achievements: list });
  return withStore('achievements', 'readwrite', (s) => {
    let last;
    for (const item of list) last = s.put(item);
    return last;
  });
}

/* ---------- The unfinished puzzle (one at a time) ---------- */

async function uploadProgressFull({ blob, thumb }, record) {
  const [photo, small] = await Promise.all([blobToBase64(blob), blobToBase64(thumb)]);
  await api('progress/full', { photo, thumb: small, progress: record });
}

// A new puzzle's first save: photo and layout together, replacing the earlier save in one step
// (so the earlier one is kept until this one is safely stored).
export async function saveProgressFull(photo, record) {
  if (user) return uploadProgressFull(photo, record);
  return putAll('saved', [{ ...record, id: 'current' }, { ...photo, id: 'current-photo' }]);
}

// Later saves: just the layout and clock. keepalive lets the last save finish while the page
// closes (browsers allow up to 64 KB for that).
export async function saveProgress(record) {
  if (!user) return withStore('saved', 'readwrite', (s) => s.put({ ...record, id: 'current' }));
  const body = { progress: record };
  return api('progress', body, { keepalive: JSON.stringify(body).length < 60000 });
}

// When saving to the account fails: a copy on this device, so the progress isn't lost.
export async function saveRecovery(photo, record) {
  if (!user) return undefined;
  return putAll('saved', [{ ...record, id: 'recovery', userId: user.id }, { ...photo, id: 'recovery-photo' }]);
}

export async function clearRecovery() {
  return withStore('saved', 'readwrite', (s) => {
    s.delete('recovery');
    return s.delete('recovery-photo');
  }).catch(() => {});
}

// The unfinished puzzle: the account's, or this device's recovery copy if that one is newer.
export async function loadProgress() {
  if (!user) return local.loadProgress();
  const recovery = await local.loadRecovery().catch(() => null);
  let progress = null;
  try {
    ({ progress } = await api('progress'));
  } catch (err) {
    if (recovery) return recovery; // offline: the copy here is all there is
    throw err;
  }
  if (recovery && (!progress || (recovery.savedAt ?? 0) > (progress.savedAt ?? 0))) return recovery;
  if (!progress) return null;
  const [blob, thumb] = await Promise.all([apiBlob('progress/photo'), apiBlob('progress/thumb')]);
  return { ...progress, photo: { blob, thumb } };
}

export async function clearProgress() {
  await clearRecovery();
  if (user) return api('progress/clear', {});
  return local.clearProgress();
}

/* ---------- Daily puzzle days ---------- */

export async function listAccountDays() {
  return (await api('daily')).days;
}

export async function addAccountDays(days) {
  return api('daily', { days });
}

// The time for today's puzzle, for the friends' ranking (signed in only).
export async function saveDailyResult(day, timeMs, moves) {
  if (user) await api('daily/result', { day, timeMs, moves });
}

// Today's times of the player and their friends, fastest first ([] when signed out).
export async function dailyBoard(day) {
  if (!user) return [];
  return (await api(`daily/friends/${day}`)).board;
}
