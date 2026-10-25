// Saving the unfinished puzzle, so it can be continued later, and saying how that went.
//
// The toolbar shows "Saving…", then "Saved", or "Couldn't save · Retry". A save that failed is
// tried again every few seconds, as soon as the connection is back, or when the player clicks.
// Signed in, a failed save also leaves a copy on this device, which is offered back if it's newer.
//
// A new puzzle's first save writes its photo and layout together (saveProgressFull), so the
// previous save is only replaced once the new one is safely stored.

import { t } from './i18n.js';
import { saveProgress, saveProgressFull, saveRecovery, clearRecovery } from './library.js';

const RETRY_MS = 15000;
const SAVED_SHOWN_MS = 2500;

export function createSaver(statusEl) {
  let game = null;       // { id, photo: Promise<{blob, thumb}>, stored: whether the photo is saved }
  let pending = null;    // the latest record waiting to be saved
  let running = null;    // the save in progress
  let retryTimer = null;
  let hideTimer = null;
  let gameCounter = 0;

  function show(state) {
    clearTimeout(hideTimer);
    statusEl.dataset.state = state;
    statusEl.hidden = state === 'idle';
    const label = statusEl.querySelector('span');
    label.textContent = state === 'saving' ? t('save.saving') : state === 'saved' ? t('save.saved') : state === 'error' ? t('save.failed') : '';
    statusEl.disabled = state !== 'error';
    statusEl.title = state === 'error'
      ? t('save.failedHelp')
      : '';
    if (state === 'saved') hideTimer = setTimeout(() => show('idle'), SAVED_SHOWN_MS);
  }

  async function attempt() {
    if (running || !pending || !game) return running;
    const record = pending;
    const current = game;
    pending = null;
    clearTimeout(retryTimer);
    show('saving');
    running = (async () => {
      try {
        if (current.stored) {
          await saveProgress(record);
        } else {
          await saveProgressFull(await current.photo, record);
          current.stored = true;
        }
        if (current === game) {
          await clearRecovery();
          show(pending ? 'saving' : 'saved');
        }
      } catch {
        // Signed in: a copy on this device, even if another game has started meanwhile.
        Promise.resolve(current.photo).then((photo) => saveRecovery(photo, record)).catch(() => {});
        if (current !== game) return;
        pending ??= record; // keep the newest, try again soon
        show('error');
        retryTimer = setTimeout(attempt, RETRY_MS);
      } finally {
        running = null;
      }
      if (pending && current === game && statusEl.dataset.state !== 'error') attempt();
    })();
    return running;
  }

  statusEl.addEventListener('click', () => attempt());
  window.addEventListener('online', () => attempt());

  return {
    // A new game: its photo (a promise of { blob, thumb }) is saved with its first layout.
    // `alreadyStored` when continuing a saved game, whose photo is already where it should be.
    startGame(photo, { alreadyStored = false } = {}) {
      game = { id: ++gameCounter, photo, stored: alreadyStored };
      pending = null;
      clearTimeout(retryTimer);
      show('idle');
    },

    // Saves this record (newer records replace older ones still waiting).
    save(record) {
      if (!game) return Promise.resolve();
      pending = record;
      return attempt() ?? Promise.resolve();
    },

    // The game ended (finished, left, or a game with a friend): nothing more to save.
    stop() {
      game = null;
      pending = null;
      clearTimeout(retryTimer);
      show('idle');
    },

    hasUnsaved: () => Boolean(pending) || statusEl.dataset.state === 'error',
  };
}
