import { loadImageFile, analyzeResolution } from './imageLoader.js';
import { pieceOptions } from './pieceOptions.js';
import { PuzzleGame } from './game.js';
import { cutLines, seededRandom } from './cutter.js';
import { DEFAULT_TABLE, createTablePicker, getTable, tableTextureUrl } from './textures.js';
import { isSoundOn, setSoundOn } from './effects.js';
import { GameTimer, formatTime, suggestedMinutes } from './timer.js';
import {
  savePuzzle, listPuzzles, deletePuzzle, listAchievements, saveAchievements,
  saveProgress, saveProgressPhoto, loadProgress, clearProgress,
} from './library.js';
import { DAILY_PIECES, dayKey, daySeed, dailyPhoto, doneDays, markDone, streak, msUntilTomorrow, renderCalendar } from './daily.js';
import { ACHIEVEMENTS, newlyEarned } from './achievements.js';
import { renderGallery, renderViewer } from './gallery.js';
import { icon, setIcon } from './icons.js';
import { initHero, setHeroRunning } from './hero.js';
import { playIntro, addReplayButton, introWillPlay, INTRO_REVEAL } from './intro.js';
import { initScrollPieces, initHeroDrift } from './scrollPieces.js';
import { createPhotoLibrary, fetchLibraryPhoto, loadLibrary } from './photoLibrary.js';
import { MOODS, loadSettings, saveSettings, playMood, stopMusic, playingMood, setVolume } from './music.js';

const DEFAULT_PIECES = 144;
const PREVIEW_MAX_H = 260;

const state = {
  photo: null,  // { name, url, width, height, canvas, quality }
  pieces: null, // { count, cols, rows, pieceW, pieceH }
  table: DEFAULT_TABLE,
  timer: { mode: 'stopwatch', minutes: 10, minutesChosen: false },
  game: null,
  clock: null,  // GameTimer of the running game
  seed: null,         // the cut of the running game, so it can be saved and restored
  pendingSeed: null,  // set before startGame() to use a particular cut (the daily puzzle)
  daily: null,        // the day key while playing that day's daily puzzle
};

const $ = (id) => document.getElementById(id);
const setupScreen = $('setup');
const gameScreen = $('game');
const galleryScreen = $('gallery');
const dropzone = $('dropzone');
const fileInput = $('file-input');
const photoInfo = $('photo-info');
const uploadError = $('upload-error');
const pieceGrid = $('piece-grid');
const laterSteps = [$('step-pieces'), $('step-table'), $('step-timer')];
const startBtn = $('start-btn');
const completeCard = $('complete-card');
const timeupCard = $('timeup-card');
const pauseCover = $('pause-cover');
const pauseBtn = $('pause-btn');
const hintBtn = $('hint-btn');
const undoBtn = $('undo-btn');
const edgesBtn = $('edges-btn');
const viewer = $('viewer');

function showScreen(screen) {
  for (const s of [setupScreen, gameScreen, galleryScreen]) s.hidden = s !== screen;
  setHeroRunning(screen === setupScreen); // the floating cards rest while out of sight
}

/* ---------- Hero ---------- */

const scrollToSteps = () => $('setup-main').scrollIntoView({ behavior: 'smooth', block: 'start' });


// The opening animation plays first; the hanging frames drop in as it clears.
initHero($('hero-cards'), $('hero-ghosts'), { delay: introWillPlay() ? INTRO_REVEAL : 0 });
// The heading lines come in slowly, one after another, as the frames drop in.
if (introWillPlay()) {
  gsap.from('.hero > *', {
    autoAlpha: 0, y: 26, duration: 1.8, stagger: 0.45, delay: INTRO_REVEAL + 0.4, ease: 'power2.out',
  });
}
playIntro();
addReplayButton(); // for trying out the intro; remove this line to hide the button
initScrollPieces(() => !setupScreen.hidden); // small pieces fall down the margins while scrolling
// The rising pieces start once the frames have dropped in (about 2 s), one by one.
initHeroDrift($('hero-drift'), () => !setupScreen.hidden, { delay: (introWillPlay() ? INTRO_REVEAL : 0) + 2 });

/* ---------- Step 1: upload ---------- */

fileInput.addEventListener('change', () => {
  library.select(null);
  handleFile(fileInput.files[0]);
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  library.select(null);
  handleFile(e.dataTransfer.files[0]);
});

$('change-photo').addEventListener('click', () => fileInput.click());

// The built-in photos: picking one loads it exactly as if it had been uploaded.
const library = createPhotoLibrary(async (photo) => {
  uploadError.hidden = true;
  try {
    await handleFile(await fetchLibraryPhoto(photo));
    if (uploadError.hidden) library.select(photo.id);
  } catch {
    uploadError.textContent = "That photo couldn't be loaded. Try another one.";
    uploadError.hidden = false;
  }
}, () => { $('photo-library').closest('.library').hidden = true; });
$('photo-library').append(library.element);

async function handleFile(file) {
  if (!file) return;
  uploadError.hidden = true;

  try {
    const photo = await loadImageFile(file);
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    photo.quality = analyzeResolution(photo.width, photo.height);
    state.photo = photo;
    state.pieces = null;
    showPhoto(photo);
    showPieceOptions();
    if (window.scrollY < $('setup-main').offsetTop - 200) scrollToSteps();
  } catch (err) {
    uploadError.textContent = err.message;
    uploadError.hidden = false;
  } finally {
    fileInput.value = ''; // lets the same file be picked again
  }
}

function showPhoto(photo) {
  const { width, height, quality } = photo;
  const megapixels = (width * height / 1e6).toFixed(1);

  $('photo-thumb').src = photo.url;
  $('photo-name').textContent = photo.name;
  $('photo-res').textContent = `${width} × ${height} px · ${megapixels} MP`;

  const badge = $('quality-badge');
  badge.textContent = quality.label;
  badge.className = `badge ${quality.level}`;
  $('quality-message').textContent = quality.message;

  dropzone.hidden = true;
  photoInfo.hidden = false;
  $('step-upload').classList.toggle('done', quality.level !== 'reject');
  updateSummary();
}

/* ---------- Summary panel ---------- */

// The photo in the summary panel, cut with the chosen number of pieces.
function drawPreview() {
  const canvas = $('preview-canvas');
  const empty = $('preview-empty');
  if (!state.photo || !state.pieces) {
    canvas.hidden = true;
    empty.hidden = false;
    return;
  }

  const { canvas: source } = state.photo;
  const box = $('summary-preview');
  const maxW = box.clientWidth - 24;
  const scale = Math.min(maxW / source.width, PREVIEW_MAX_H / source.height);
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  const { cols, rows } = state.pieces;
  const lines = cutLines(cols, rows, w, h, seededRandom(cols * 1000 + rows));
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
  ctx.save();
  ctx.translate(0.6, 0.6);
  ctx.stroke(lines);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, .7)';
  ctx.stroke(lines);

  canvas.hidden = false;
  empty.hidden = true;
}

function updateSummary() {
  const ready = Boolean(state.photo && state.pieces);
  const { pieces } = state;
  $('sum-pieces').textContent = !pieces ? '–'
    : pieces.pace ? `${pieces.pace} · ${pieces.count}` : `${pieces.count} (${pieces.cols} × ${pieces.rows})`;
  $('sum-table').textContent = ready ? getTable(state.table).name : '–';
  $('sum-timer').textContent = !ready ? '–'
    : state.timer.mode === 'countdown' ? `Countdown · ${state.timer.minutes} min` : 'Stopwatch';
  startBtn.disabled = !ready;
  drawPreview();
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!setupScreen.hidden) drawPreview();
  }, 150);
});

/* ---------- Step 2: number of pieces ---------- */

function showPieceOptions() {
  const { photo } = state;
  pieceGrid.replaceChildren();

  const usable = photo.quality.level !== 'reject';
  for (const step of laterSteps) {
    step.classList.toggle('locked', !usable);
    step.classList.toggle('done', usable);
  }
  if (!usable) {
    updateSummary();
    return;
  }

  const options = pieceOptions(photo.width, photo.height, window.innerWidth, window.innerHeight);

  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'option';
    if (option.disabledReason) {
      label.classList.add('disabled');
      label.title = option.disabledReason;
    }

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'pieces';
    input.disabled = Boolean(option.disabledReason);
    input.addEventListener('change', () => selectPieces(option));

    const count = document.createElement('strong');
    count.textContent = option.count;
    const grid = document.createElement('span');
    grid.textContent = `${option.cols} × ${option.rows}`;

    label.append(input, count, grid);
    pieceGrid.append(label);
    option.input = input;
  }

  // Start with the allowed option closest to the default.
  let allowed = options.filter((o) => !o.disabledReason);
  if (allowed.length === 0) {
    // Tiny screen and a very long panorama: still let the smallest puzzle through.
    options[0].input.disabled = false;
    options[0].input.closest('label').classList.remove('disabled');
    allowed = [options[0]];
  }
  showPaces(allowed);
  const closest = (target) => allowed.reduce((best, o) =>
    Math.abs(o.count - target) < Math.abs(best.count - target) ? o : best);
  selectPieces(closest(DEFAULT_PIECES));
}

// The calm way to pick a size: each pace maps to the allowed piece count closest to its target.
const PACES = [
  { name: 'A quick break', target: 24 },
  { name: 'Settle in', target: 48 },
  { name: 'Stay a while', target: 144 },
  { name: 'Lose yourself', target: 300 },
];

// Rough solving time for a pace card, e.g. "10 min" or "1 hour".
function aboutTime(pieceCount) {
  const minutes = suggestedMinutes(pieceCount);
  return minutes >= 60 && minutes % 60 === 0
    ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`
    : `${minutes} min`;
}

let paceInputs = new Map(); // piece count → pace radio

function showPaces(allowed) {
  const grid = $('pace-grid');
  grid.replaceChildren();
  paceInputs = new Map();
  let previous = null;

  for (const pace of PACES) {
    const option = allowed.reduce((best, o) =>
      Math.abs(o.count - pace.target) < Math.abs(best.count - pace.target) ? o : best);
    // Two paces landing on the same count means the photo (or screen) can't go bigger.
    const unavailable = option === previous;
    previous = option;

    const label = document.createElement('label');
    label.className = `pace${unavailable ? ' disabled' : ''}`;
    if (unavailable) label.title = 'Your photo or screen is too small for this many pieces';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'pace';
    input.disabled = unavailable;
    input.addEventListener('change', () => selectPieces(option));
    const name = document.createElement('strong');
    name.textContent = pace.name;
    const detail = document.createElement('span');
    detail.textContent = unavailable ? 'Not available here' : `${option.count} pieces · ${aboutTime(option.count)}`;
    label.append(input, name, detail);
    grid.append(label);
    if (!unavailable) paceInputs.set(option.count, { input, name: pace.name });
  }
}

function selectPieces(option) {
  const { count, cols, rows, pieceW, pieceH } = option;
  // Keep the pace cards and the exact-number list showing the same choice.
  option.input.checked = true;
  const pace = paceInputs.get(count);
  for (const input of document.querySelectorAll('input[name="pace"]')) input.checked = input === pace?.input;
  state.pieces = { count, cols, rows, pieceW, pieceH, pace: pace?.name ?? null };
  $('piece-summary').textContent =
    `${count} pieces in ${cols} × ${rows}. Each piece shows about ${Math.round(pieceW)} × ${Math.round(pieceH)} px of your photo.`;
  suggestTime(count);
  updateSummary();
}

/* ---------- Step 3: table ---------- */

function pickTable(id) {
  state.table = id;
  tableTextureUrl(id); // start loading it now so it's ready when the game starts
  state.game?.setTable(id);
  updateSummary();
}

$('setup-table-picker').append(createTablePicker(state.table, pickTable));
tableTextureUrl(state.table);

/* ---------- Step 4: timer ---------- */

const countdownOptions = $('countdown-options');
const minutesInput = $('countdown-minutes');

for (const radio of document.querySelectorAll('input[name="timer-mode"]')) {
  radio.addEventListener('change', () => {
    state.timer.mode = radio.value;
    countdownOptions.hidden = radio.value !== 'countdown';
    updateSummary();
  });
}

$('minute-presets').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-minutes]');
  if (!button) return;
  state.timer.minutesChosen = true;
  setMinutes(Number(button.dataset.minutes));
});

minutesInput.addEventListener('input', () => {
  state.timer.minutesChosen = true;
  const minutes = Math.round(Number(minutesInput.value));
  if (minutes >= 1) setMinutes(Math.min(600, minutes), false);
});
minutesInput.addEventListener('blur', () => setMinutes(state.timer.minutes));

function setMinutes(minutes, updateInput = true) {
  state.timer.minutes = minutes;
  if (updateInput) minutesInput.value = minutes;
  for (const b of $('minute-presets').children) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.minutes) === minutes));
  }
  updateSummary();
}

// Called when the piece count changes: suggest a fitting time unless the player picked one.
function suggestTime(pieceCount) {
  const minutes = suggestedMinutes(pieceCount);
  $('minutes-hint').textContent = `Suggested for ${pieceCount} pieces: ${minutes} minutes.`;
  if (!state.timer.minutesChosen) setMinutes(minutes);
}

/* ---------- Play ---------- */

let completeCardTimer = null;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// restore: a saved game from loadProgress(), to pick up where the player left off.
async function startGame({ restore = null } = {}) {
  stopGame();
  state.seed = restore?.seed ?? state.pendingSeed ?? Math.floor(Math.random() * 2 ** 31);
  state.pendingSeed = null;
  showScreen(gameScreen);
  showProgress(0);
  $('game-title').textContent = `${state.pieces.count}-piece puzzle`;
  $('reference-img').src = state.photo.url;

  const countdown = state.timer.mode === 'countdown';
  const limitMs = restore ? restore.limitMs : countdown ? state.timer.minutes * 60000 : null;
  state.clock = new GameTimer({
    limitSeconds: limitMs ? limitMs / 1000 : null,
    onTick: showClock,
    onExpire: timeUp,
  });
  if (restore) state.clock.spent = restore.elapsed;
  showClock(state.clock);
  setPlayControls(false);

  // Cutting hundreds of pieces takes a moment; let the loading screen paint first.
  const loading = $('loading');
  loading.hidden = false;
  await nextFrame();
  await nextFrame();

  state.game = new PuzzleGame($('table'), state.photo, state.pieces, state.table, {
    seed: state.seed,
    restore: restore?.layout,
    onChange: scheduleSave,
    onSpill: () => {
      state.clock.start();
      setPlayControls(true);
    },
    onProgress: showProgress,
    onComplete: () => {
      const { clock } = state;
      clock.pause();
      clearTimeout(saveTimer);
      clearProgress().catch(() => {}).finally(refreshResume);
      showDailyDone();
      setPlayControls(false);
      const spare = clock.remaining;
      $('stat-time').textContent = formatTime(clock.elapsed);
      $('stat-pieces').textContent = state.pieces.count;
      $('stat-extra-label').textContent = spare === null ? 'Table' : 'To spare';
      $('stat-extra').textContent = spare === null ? getTable(state.table).name : formatTime(spare);
      const { hintsUsed, moves } = state.game;
      $('stat-hints').textContent = hintsUsed === 0 ? 'None' : hintsUsed;
      $('stat-moves').textContent = moves;
      const stars = starRating(state.pieces.count, moves, hintsUsed);
      showStars(stars);
      $('saved-note').replaceChildren();
      $('new-medals').replaceChildren();
      $('best-badge').hidden = true;
      const result = {
        timeMs: clock.elapsed,
        limitMs: countdown ? state.timer.minutes * 60000 : null,
        // "Keep going" after time ran out removes the limit, so this is only true when the clock was beaten.
        beatClock: spare !== null,
        hintsUsed,
        moves,
        stars,
      };
      // Compare with earlier puzzles of the same size before this one is saved among them.
      showPersonalBest(state.pieces.count, clock.elapsed).finally(() => saveToGallery(result));
      // Let the light sweep and the frame finish before the card appears.
      completeCardTimer = setTimeout(() => {
        // Beside the puzzle when the table is wide enough for both side by side.
        completeCard.classList.toggle('beside', $('table').clientWidth >= 1000);
        completeCard.hidden = false;
        state.game?.makeRoomForCard(completeCard);
      }, 3000);
    },
  });
  loading.hidden = true;

  if (restore) {
    state.game.moves = restore.moves ?? 0;
    state.game.hintsUsed = restore.hintsUsed ?? 0;
    showProgress(state.game.progress(), state.game.connectedPieces(), state.game.puzzle.pieces.length);
    state.clock.start();
    setPlayControls(true);
  } else {
    // One unfinished puzzle is kept at a time: this one replaces any earlier save.
    saveResumePhoto(state.photo);
  }
}

/* ---------- Save and continue ---------- */

let saveTimer = null;

function canvasBlob(canvas, quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// The photo is written once per game; the layout is saved after every move.
async function saveResumePhoto(photo) {
  try {
    await clearProgress();
    const thumbScale = Math.min(1, 360 / Math.max(photo.canvas.width, photo.canvas.height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.round(photo.canvas.width * thumbScale);
    thumb.height = Math.round(photo.canvas.height * thumbScale);
    thumb.getContext('2d').drawImage(photo.canvas, 0, 0, thumb.width, thumb.height);
    const [blob, thumbBlob] = await Promise.all([canvasBlob(photo.canvas, 0.92), canvasBlob(thumb, 0.8)]);
    if (state.photo !== photo) return; // another game started meanwhile
    await saveProgressPhoto({ blob, thumb: thumbBlob });
  } catch {
    // Storage unavailable: the game still plays, it just can't be continued later.
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

function saveNow() {
  clearTimeout(saveTimer);
  const { game, clock } = state;
  if (!game?.ready || game.groups.size < 2 || !clock) return Promise.resolve();
  return saveProgress({
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
    progress: game.progress(),
    daily: state.daily,
    savedAt: Date.now(),
  }).catch(() => {});
}

// Closing or hiding the tab saves straight away, including the time on the clock.
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('pagehide', () => saveNow());

let resumeThumbUrl = null;

async function refreshResume() {
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
  $('resume-title').textContent = saved.daily ? 'Daily puzzle' : saved.name.replace(/\.[a-z0-9]+$/i, '');
  $('resume-meta').textContent = `${saved.pieces.count} pieces · ${formatTime(saved.elapsed)} played · ${savedAgo(saved.savedAt)}`;
  card.hidden = false;
}

function savedAgo(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

async function continueSaved() {
  const button = $('continue-btn');
  button.disabled = true;
  try {
    const saved = await loadProgress();
    if (!saved) return refreshResume();
    const photo = await loadImageFile(new File([saved.photo.blob], saved.name, { type: 'image/jpeg' }));
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    photo.quality = analyzeResolution(photo.width, photo.height);
    state.photo = photo;
    showPhoto(photo);
    showPieceOptions();
    library.select(null);
    state.pieces = saved.pieces;
    state.table = saved.table;
    state.timer = { ...state.timer, ...saved.timer };
    state.daily = saved.daily ?? null;
    await startGame({ restore: saved });
  } catch {
    uploadError.textContent = "That puzzle couldn't be opened. Try starting a new one.";
    uploadError.hidden = false;
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
refreshResume();

/* ---------- Daily puzzle ---------- */

let dailyToday = null; // { key, photo } for today's daily puzzle
let dailyCountdown = null;

async function refreshDaily() {
  const card = $('daily-card');
  const key = dayKey();
  if (dailyToday?.key !== key) {
    const photo = dailyPhoto(await loadLibrary(), key);
    if (!photo) {
      card.hidden = true;
      return;
    }
    dailyToday = { key, photo };
  }
  const { photo } = dailyToday;
  const days = doneDays();
  const run = streak(days, key);
  const doneToday = days.has(key);

  $('daily-img').src = `assets/library/${photo.id}-thumb.jpg`;
  $('daily-title').textContent = photo.name;
  $('daily-date').textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const streakEl = $('daily-streak');
  streakEl.classList.toggle('cold', run === 0);
  streakEl.replaceChildren(icon('i-flame'), run > 0 ? `${run}-day streak` : 'Start a streak today');

  const button = $('daily-btn');
  button.classList.toggle('done', doneToday);
  button.disabled = doneToday;
  clearInterval(dailyCountdown);
  if (doneToday) {
    const showNext = () => {
      const ms = msUntilTomorrow();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor(ms / 60000) % 60;
      $('daily-message').textContent = `Lovely work. A new puzzle arrives in ${h} h ${m} min. See you tomorrow.`;
      if (dayKey() !== key) refreshDaily(); // midnight passed while the page was open
    };
    showNext();
    dailyCountdown = setInterval(showNext, 30000);
    button.replaceChildren(icon('i-check'), 'Done for today');
  } else {
    $('daily-message').textContent = run > 0
      ? `Play today to keep your ${run}-day streak going.`
      : `A new ${DAILY_PIECES}-piece puzzle every day, the same one for everyone.`;
    button.textContent = 'Play today’s puzzle';
  }
  renderCalendar($('daily-cal'), days, key);
  card.hidden = false;
}

async function startDaily() {
  if (!dailyToday) return;
  const { key, photo: libraryPhoto } = dailyToday;
  const button = $('daily-btn');
  button.disabled = true;
  try {
    const photo = await loadImageFile(await fetchLibraryPhoto(libraryPhoto));
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    photo.quality = analyzeResolution(photo.width, photo.height);
    state.photo = photo;
    showPhoto(photo);
    showPieceOptions();
    library.select(libraryPhoto.id);
    // The daily size, or the closest the screen allows.
    const options = pieceOptions(photo.width, photo.height, window.innerWidth, window.innerHeight)
      .filter((o) => !o.disabledReason);
    const option = options.reduce((best, o) =>
      Math.abs(o.count - DAILY_PIECES) < Math.abs(best.count - DAILY_PIECES) ? o : best);
    state.pieces = { count: option.count, cols: option.cols, rows: option.rows, pieceW: option.pieceW, pieceH: option.pieceH, pace: null };
    state.timer = { ...state.timer, mode: 'stopwatch' };
    state.daily = key;
    state.pendingSeed = daySeed(key);
    await startGame();
  } catch {
    uploadError.textContent = "Today's puzzle couldn't be loaded. Try again in a moment.";
    uploadError.hidden = false;
  } finally {
    refreshDaily();
  }
}

// On the complete card: mark the day done and celebrate the streak.
function showDailyDone() {
  const note = $('daily-note');
  note.hidden = true;
  if (!state.daily) return;
  const days = markDone(state.daily);
  const run = streak(days);
  note.replaceChildren(icon('i-flame'), run > 1 ? `Daily puzzle done · ${run}-day streak` : 'Daily puzzle done · streak started');
  note.hidden = false;
  refreshDaily();
}

$('daily-btn').addEventListener('click', startDaily);
refreshDaily();

// 3 stars, minus one for leaning on hints and one for many more moves than pieces.
function starRating(pieceCount, moves, hintsUsed) {
  let stars = 3;
  if (hintsUsed > Math.max(1, Math.round(pieceCount / 40))) stars--;
  if (moves > pieceCount * 1.6) stars--;
  return Math.max(1, stars);
}

function showStars(stars) {
  const row = $('result-stars');
  row.setAttribute('aria-label', `${stars} of 3 stars`);
  row.replaceChildren(...[0, 1, 2].map((i) => {
    const star = icon('i-star');
    if (i < stars) {
      star.classList.add('earned');
      star.style.animationDelay = `${0.35 + i * 0.18}s`; // the card is hidden until it appears, so this counts from then
    }
    return star;
  }));
}

// "New personal best" when this beats every earlier finish with the same number of pieces.
async function showPersonalBest(pieceCount, timeMs) {
  const badge = $('best-badge');
  try {
    const earlier = (await listPuzzles()).filter((p) => p.pieces === pieceCount && p.timeMs);
    if (!earlier.length) return;
    const best = Math.min(...earlier.map((p) => p.timeMs));
    badge.classList.toggle('quiet', timeMs >= best);
    badge.textContent = timeMs < best ? `New personal best · ${pieceCount} pieces` : `Your best: ${formatTime(best)}`;
    badge.hidden = false;
  } catch {
    // Gallery storage unavailable: just leave the badge out.
  }
}

// Tears down the current game (if any) and hides all of its cards.
function stopGame() {
  clearTimeout(completeCardTimer);
  edgesBtn.setAttribute('aria-pressed', 'false');
  state.clock?.pause();
  state.clock = null;
  state.game?.destroy();
  state.game = null;
  completeCard.hidden = true;
  completeCard.classList.remove('beside');
  timeupCard.hidden = true;
  pauseCover.hidden = true;
  showPauseButton(false);
  setReference(false);
  setPopoverOpen(false);
}

function leaveGame() {
  saveNow().finally(refreshResume);
  stopGame();
  if (document.fullscreenElement) document.exitFullscreen();
  showScreen(setupScreen);
  drawPreview();
}

const MILESTONES = [
  [25, 'A quarter done. Nice and steady.'],
  [50, 'Halfway there. Take your time.'],
  [75, 'Three quarters done. Almost there.'],
];
let milestonesShown = new Set();
let toastTimer = null;

function showProgress(share, connected = 0, total = state.pieces?.count ?? 0) {
  const percent = Math.floor(share * 100);
  $('progress-fill').style.width = `${percent}%`;
  $('progress-text').textContent = `${percent}%`;
  $('progress').title = `${connected} of ${total} pieces connected`;

  if (share === 0) milestonesShown = new Set();
  for (const [at, message] of MILESTONES) {
    if (percent >= at && percent < 100 && !milestonesShown.has(at)) {
      milestonesShown.add(at);
      showToast(message);
    }
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function showClock(clock) {
  const countdown = clock.remaining !== null;
  const ms = countdown ? Math.ceil(clock.remaining / 1000) * 1000 : clock.elapsed;
  $('clock-time').textContent = formatTime(ms);
  const clockEl = $('clock');
  setIcon(clockEl.querySelector('.clock-icon'), countdown ? 'i-hourglass' : 'i-clock');
  clockEl.classList.toggle('running', clock.running);
  clockEl.classList.toggle('warning', countdown && clock.remaining <= Math.min(60000, clock.limit * 0.1));
}

function setPaused(paused) {
  const { clock, game } = state;
  if (!clock || !game) return;
  if (paused) clock.pause();
  else clock.start();
  game.setPaused(paused);
  pauseCover.hidden = !paused;
  showPauseButton(paused);
  hintBtn.disabled = paused;
}

// Pause and hint only make sense while the pieces are out and the clock is running.
function setPlayControls(enabled) {
  pauseBtn.disabled = !enabled;
  hintBtn.disabled = !enabled;
  undoBtn.disabled = !enabled;
  edgesBtn.disabled = !enabled;
}

function setEdgesOnly(on) {
  edgesBtn.setAttribute('aria-pressed', String(on));
  state.game?.setEdgesOnly(on);
}

undoBtn.addEventListener('click', () => state.game?.undo());
edgesBtn.addEventListener('click', () => setEdgesOnly(edgesBtn.getAttribute('aria-pressed') !== 'true'));

function showPauseButton(paused) {
  setIcon(pauseBtn.querySelector('svg'), paused ? 'i-play' : 'i-pause');
  pauseBtn.title = paused ? 'Resume (P)' : 'Pause (P)';
  pauseBtn.setAttribute('aria-label', pauseBtn.title);
}

function timeUp() {
  state.game.setPaused(true);
  setPlayControls(false);
  const percent = Math.round(state.game.progress() * 100);
  $('timeup-text').textContent = `You got ${percent}% of the puzzle done. Keep going without the clock, or start over?`;
  timeupCard.hidden = false;
}

startBtn.addEventListener('click', () => {
  state.daily = null; // a puzzle set up by hand is never the daily one
  startGame();
});
$('replay-btn').addEventListener('click', () => {
  if (state.daily) state.pendingSeed = daySeed(state.daily); // the daily puzzle keeps its cut
  startGame();
});
$('new-btn').addEventListener('click', leaveGame);
$('timeup-new-btn').addEventListener('click', leaveGame);
$('back-btn').addEventListener('click', leaveGame);

pauseBtn.addEventListener('click', () => setPaused(pauseCover.hidden));
hintBtn.addEventListener('click', () => state.game?.hint());
$('resume-btn').addEventListener('click', () => setPaused(false));

$('keep-going-btn').addEventListener('click', () => {
  timeupCard.hidden = true;
  state.clock.removeLimit();
  setPlayControls(true);
  setPaused(false);
});

// Stop the clock when the player switches to another tab or app.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.clock?.running) setPaused(true);
});

/* ---------- Toolbar tools ---------- */

const referenceBtn = $('reference-btn');
function setReference(show) {
  $('reference').hidden = !show;
  referenceBtn.setAttribute('aria-pressed', String(show));
}
referenceBtn.addEventListener('click', () => setReference($('reference').hidden));
$('reference-close').addEventListener('click', () => setReference(false));

const soundBtn = $('sound-btn');
function showSound() {
  const on = isSoundOn();
  setIcon(soundBtn.querySelector('svg'), on ? 'i-sound-on' : 'i-sound-off');
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.title = on ? 'Sound on' : 'Sound off';
}
soundBtn.addEventListener('click', () => {
  setSoundOn(!isSoundOn());
  showSound();
});
showSound();

const fullscreenBtn = $('fullscreen-btn');
fullscreenBtn.hidden = !document.fullscreenEnabled;
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const on = Boolean(document.fullscreenElement);
  setIcon(fullscreenBtn.querySelector('svg'), on ? 'i-shrink' : 'i-expand');
  fullscreenBtn.title = on ? 'Exit full screen (F)' : 'Full screen (F)';
});

// Table switcher
const tableBtn = $('table-btn');
const tablePopover = $('table-popover');

function setPopoverOpen(open) {
  if (open) tablePopover.replaceChildren(createTablePicker(state.table, pickTable));
  tablePopover.hidden = !open;
  tableBtn.setAttribute('aria-expanded', String(open));
}

tableBtn.addEventListener('click', () => setPopoverOpen(tablePopover.hidden));
document.addEventListener('pointerdown', (e) => {
  if (!tablePopover.hidden && !e.target.closest('.popover-wrap')) setPopoverOpen(false);
});

// Keyboard shortcuts while playing: P pause/resume, H hint, R reference picture, M music, F full screen.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPopoverOpen(false);
  if (!gameScreen.hidden && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !undoBtn.disabled) {
    e.preventDefault();
    state.game?.undo();
    return;
  }
  if (gameScreen.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input')) return;
  const key = e.key.toLowerCase();
  if (key === 'e' && !edgesBtn.disabled) setEdgesOnly(edgesBtn.getAttribute('aria-pressed') !== 'true');
  if (key === 'p' && !pauseBtn.disabled) setPaused(pauseCover.hidden);
  else if (key === 'h' && !hintBtn.disabled) state.game?.hint();
  else if (key === 'r') setReference($('reference').hidden);
  else if (key === 'm') setMusicPanel(musicPanel.hidden);
  else if (key === 'f' && document.fullscreenEnabled) toggleFullscreen();
});

/* ---------- Music ---------- */

const musicPanel = $('music');
const musicBtn = $('music-btn');
const musicToggle = $('music-toggle');
const musicSettings = loadSettings();
const ownAudio = new Audio();
let ownTracks = []; // { name, url } picked by the player this session
let ownIndex = 0;
let musicSource = 'mood'; // what play resumes: a generated mood or the player's own files

function renderMoods() {
  $('music-moods').replaceChildren(...MOODS.map((mood) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mood';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(musicSource === 'mood' && mood.id === musicSettings.mood));
    const name = document.createElement('strong');
    name.textContent = mood.name;
    const description = document.createElement('span');
    description.textContent = mood.description;
    button.append(name, description);
    button.addEventListener('click', () => {
      musicSettings.mood = mood.id;
      saveSettings(musicSettings);
      playMusic('mood');
    });
    return button;
  }));
}

function isMusicPlaying() {
  return Boolean(playingMood()) || !ownAudio.paused;
}

function playMusic(source) {
  musicSource = source;
  stopMusic();
  ownAudio.pause();
  if (source === 'own' && ownTracks.length) {
    ownAudio.src = ownTracks[ownIndex].url;
    ownAudio.volume = musicSettings.volume;
    ownAudio.play().catch(() => {});
  } else {
    musicSource = 'mood';
    playMood(musicSettings.mood, musicSettings.volume);
  }
  showMusicState();
}

function pauseMusic() {
  stopMusic();
  ownAudio.pause();
  showMusicState();
}

function showMusicState() {
  const playing = isMusicPlaying();
  setIcon(musicToggle.querySelector('svg'), playing ? 'i-pause' : 'i-play');
  musicToggle.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
  const what = musicSource === 'own' && ownTracks.length
    ? ownTracks[ownIndex].name
    : MOODS.find((m) => m.id === musicSettings.mood).name;
  $('music-now').textContent = playing ? `Playing · ${what}` : `Paused · ${what}`;
  musicBtn.classList.toggle('playing', playing);
  renderMoods();
}

function setMusicPanel(open) {
  musicPanel.hidden = !open;
  musicBtn.setAttribute('aria-pressed', String(open));
}

musicBtn.addEventListener('click', () => setMusicPanel(musicPanel.hidden));
$('music-close').addEventListener('click', () => setMusicPanel(false));
musicToggle.addEventListener('click', () => (isMusicPlaying() ? pauseMusic() : playMusic(musicSource)));

const volumeInput = $('music-volume');
volumeInput.value = musicSettings.volume;
volumeInput.addEventListener('input', () => {
  musicSettings.volume = Number(volumeInput.value);
  setVolume(musicSettings.volume);
  ownAudio.volume = musicSettings.volume;
  saveSettings(musicSettings);
});

$('music-files').addEventListener('change', (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith('audio/'));
  if (!files.length) return;
  for (const track of ownTracks) URL.revokeObjectURL(track.url);
  ownTracks = files.map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
  ownIndex = 0;
  $('music-own-label').textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'} loaded · choose others`;
  e.target.value = '';
  playMusic('own');
});

// Own files play one after another, then start over.
ownAudio.addEventListener('ended', () => {
  ownIndex = (ownIndex + 1) % ownTracks.length;
  playMusic('own');
});

renderMoods();
showMusicState();

/* ---------- Gallery ---------- */

const GALLERY_IMAGE_SIDE = 1600;

function photoBlob(source) {
  const scale = Math.min(1, GALLERY_IMAGE_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve({ blob, canvas }), 'image/jpeg', 0.9));
}

// Hangs the finished puzzle in the gallery and reports any new achievements on the complete card.
async function saveToGallery(result) {
  const savedNote = $('saved-note');
  const { photo, pieces, table } = state; // read now: the player may start another game meanwhile
  try {
    const { blob, canvas } = await photoBlob(photo.canvas);
    await savePuzzle({
      createdAt: Date.now(),
      name: photo.name,
      image: blob,
      imageW: canvas.width,
      imageH: canvas.height,
      pieces: pieces.count,
      cols: pieces.cols,
      rows: pieces.rows,
      table,
      ...result,
    });

    const [puzzles, earned] = await Promise.all([listPuzzles(), listAchievements()]);
    const fresh = newlyEarned(puzzles, new Set(earned.map((a) => a.id)));
    if (fresh.length) await saveAchievements(fresh.map((a) => ({ id: a.id, earnedAt: Date.now() })));
    showGalleryCount(puzzles.length);

    savedNote.replaceChildren(icon('i-check'), 'Framed and hung in your gallery');
    $('new-medals').replaceChildren(...fresh.map((a, i) => {
      const medal = document.createElement('span');
      medal.className = 'new-medal';
      medal.style.animationDelay = `${1.8 + i * 0.25}s`;
      const coin = document.createElement('span');
      coin.className = 'coin';
      coin.append(icon(a.icon, 'coin-icon'));
      medal.append(coin, `Achievement unlocked: ${a.name}`);
      return medal;
    }));
  } catch (err) {
    console.error(err);
    savedNote.textContent = "Couldn't save to your gallery: this browser isn't allowing storage.";
  }
}

function showGalleryCount(count) {
  const badge = $('gallery-count');
  badge.textContent = count;
  badge.hidden = count === 0;
}
listPuzzles().then((puzzles) => showGalleryCount(puzzles.length), () => {});

let openPuzzle = null; // the puzzle shown in the close-up view

async function showGallery() {
  showScreen(galleryScreen);
  tableTextureUrl('oak').then((url) => { $('floor').style.backgroundImage = `url(${url})`; });

  const parts = {
    shelf: $('achievement-shelf'),
    frames: $('frames'),
    emptyNote: $('empty-wall'),
    stats: $('gallery-stats'),
  };
  try {
    const [puzzles, earned] = await Promise.all([listPuzzles(), listAchievements()]);
    // Catch up on anything missed, e.g. if the page closed while a finished puzzle was saving.
    const missed = newlyEarned(puzzles, new Set(earned.map((a) => a.id)))
      .map((a) => ({ id: a.id, earnedAt: Date.now() }));
    if (missed.length) {
      await saveAchievements(missed);
      earned.push(...missed);
    }
    showGalleryCount(puzzles.length);
    renderGallery({
      ...parts,
      puzzles,
      earned: new Map(earned.filter((a) => ACHIEVEMENTS.some((x) => x.id === a.id)).map((a) => [a.id, a.earnedAt])),
      onOpen: (puzzle) => {
        openPuzzle = puzzle;
        renderViewer($('viewer-body'), puzzle);
        resetDeleteButton();
        viewer.showModal();
      },
    });
  } catch (err) {
    console.error(err);
    parts.emptyNote.textContent = "Your gallery can't be opened: this browser isn't allowing storage.";
    parts.emptyNote.hidden = false;
  }
}

function hideGallery() {
  showScreen(setupScreen);
  drawPreview();
}

$('open-gallery').addEventListener('click', showGallery);
$('gallery-back-btn').addEventListener('click', hideGallery);
$('view-gallery-btn').addEventListener('click', () => {
  stopGame();
  showGallery();
});

$('viewer-close').addEventListener('click', () => viewer.close());
// Clicking the dimmed backdrop (outside the dialog box) closes it too.
viewer.addEventListener('click', (e) => {
  if (e.target !== viewer) return;
  const r = viewer.getBoundingClientRect();
  const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (outside) viewer.close();
});

$('viewer-download').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(openPuzzle.image);
  link.download = `${openPuzzle.name.replace(/\.[^.]+$/, '')}-puzzle.jpg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

$('viewer-replay').addEventListener('click', async () => {
  const { image, name } = openPuzzle;
  viewer.close();
  hideGallery();
  window.scrollTo(0, 0);
  await handleFile(new File([image], name, { type: image.type }));
});

// Removing asks for a second click to confirm.
const deleteBtn = $('viewer-delete');
function resetDeleteButton() {
  deleteBtn.dataset.confirm = '';
  deleteBtn.querySelector('span').textContent = 'Remove';
}
deleteBtn.addEventListener('click', async () => {
  if (!deleteBtn.dataset.confirm) {
    deleteBtn.dataset.confirm = 'yes';
    deleteBtn.querySelector('span').textContent = 'Click again to remove';
    return;
  }
  await deletePuzzle(openPuzzle.id);
  viewer.close();
  showGallery();
});
