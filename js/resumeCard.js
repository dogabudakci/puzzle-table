// Saving the unfinished puzzle (see saving.js for how), and the "Continue your puzzle" card.

import { $, app, state, showUploadError } from './app.js';
import { loadProgress, clearProgress } from './library.js';
import { createSaver } from './saving.js';
import { loadImageFile, analyzeResolution } from './imageLoader.js';
import { formatTime } from './timer.js';
import { t } from './i18n.js';


let saveTimer = null;

function canvasBlob(canvas, quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// One unfinished puzzle is kept at a time. The photo goes with the first save of a game (and
// only then replaces the earlier save); after that, just the layout and clock are saved.
export const saver = createSaver($('save-status'));

export async function photoBlobs(photo) {
  const thumbScale = Math.min(1, 360 / Math.max(photo.canvas.width, photo.canvas.height));
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(photo.canvas.width * thumbScale);
  thumb.height = Math.round(photo.canvas.height * thumbScale);
  thumb.getContext('2d').drawImage(photo.canvas, 0, 0, thumb.width, thumb.height);
  const [blob, thumbBlob] = await Promise.all([canvasBlob(photo.canvas, 0.85), canvasBlob(thumb, 0.8)]);
  return { blob, thumb: thumbBlob };
}

// Leaving with progress that couldn't be saved yet: the browser asks before closing the page.
window.addEventListener('beforeunload', (e) => {
  if (saver.hasUnsaved()) e.preventDefault();
});

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

export function saveNow() {
  clearTimeout(saveTimer);
  const { game, clock } = state;
  if (!game?.ready || game.groups.size < 2 || !clock || state.match) return Promise.resolve();
  return saver.save({
    name: state.photo.name,
    pieces: state.pieces,
    seed: state.seed,
    table: state.table,
    timer: { ...state.timer },
    elapsed: clock.elapsed,
    limitMs: clock.limit,
    moves: game.moves,
    hintsUsed: game.hintsUsed,
    layout: game.serialize(),
    world: game.worldSize,
    progress: game.progress(),
    daily: state.daily,
    mystery: state.mystery,
    peeked: state.peeked,
    savedAt: Date.now(),
  });
}

// Closing or hiding the tab saves straight away, including the time on the clock.
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('pagehide', () => saveNow());

let resumeThumbUrl = null;

export async function refreshResume() {
  const card = $('resume-card');
  let saved = null;
  try {
    saved = await loadProgress();
  } catch {
    // Storage unavailable: nothing to continue.
  }
  if (!saved) {
    card.hidden = true;
    return;
  }
  if (resumeThumbUrl) URL.revokeObjectURL(resumeThumbUrl);
  resumeThumbUrl = URL.createObjectURL(saved.photo.thumb);
  $('resume-img').src = resumeThumbUrl;
  const percent = Math.round((saved.progress ?? 0) * 100);
  $('resume-pct').textContent = `${percent}%`;
  $('resume-fill').style.width = `${percent}%`;
  $('resume-title').textContent = saved.mystery ? t('start.mysteryPuzzle')
    : saved.daily ? t('daily.dailyPuzzle') : saved.name.replace(/\.[a-z0-9]+$/i, '');
  $('resume-card').classList.toggle('mystery', Boolean(saved.mystery));
  $('resume-meta').textContent = `${t('start.pieces2', { a: saved.pieces.count })} · ${t('resume.played', { a: formatTime(saved.elapsed) })} · ${savedAgo(saved.savedAt)}`;
  card.hidden = false;
}

function savedAgo(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return t('resume.justNow');
  if (minutes < 60) return t('resume.minAgo', { a: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('resume.hAgo', { a: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t('resume.yesterday') : t('resume.daysAgo', { a: days });
}

export async function continueSaved() {
  const button = $('continue-btn');
  button.disabled = true;
  try {
    const saved = await loadProgress();
    if (!saved) return refreshResume();
    const photo = await loadImageFile(new File([saved.photo.blob], saved.name, { type: 'image/jpeg' }));
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    photo.quality = analyzeResolution(photo.width, photo.height);
    state.photo = photo;
    app.showPhoto(photo);
    app.showPieceOptions();
    app.library.select(null);
    state.pieces = saved.pieces;
    state.table = saved.table;
    state.timer = { ...state.timer, ...saved.timer };
    state.daily = saved.daily ?? null;
    state.mystery = saved.mystery ?? null;
    app.showPhoto(photo); // again, now that it's known whether the photo is a secret
    await app.startGame({ restore: saved });
  } catch {
    showUploadError(t('resume.puzzleCouldnOpenedTry'));
  } finally {
    button.disabled = false;
  }
}

$('continue-btn').addEventListener('click', continueSaved);
$('discard-btn').addEventListener('click', async () => {
  try {
    await clearProgress();
  } finally {
    refreshResume();
  }
});
