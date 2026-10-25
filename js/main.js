// The start page (choosing a photo, pieces, table and timer) and the play screen. The other
// parts of the app live in their own files and are wired up here:
//   resumeCard.js (saving, Continue), dailyCard.js, friendPlay.js, galleryScreen.js,
//   resultCard.js (the complete card), musicPanel.js, settingsPanel.js; app.js holds what they share.

import { $, app, state, screens, showScreen, rememberOpenGame, openGameOnLoad } from './app.js';
import { loadImageFile, analyzeResolution } from './imageLoader.js';
import { pieceOptions } from './pieceOptions.js';
import { PuzzleGame, MAX_ZOOM } from './game.js';
import { cutLines, seededRandom } from './cutter.js';
import { createTablePicker, getTable, tableTextureUrl } from './textures.js';
import { isSoundOn, setSoundOn } from './effects.js';
import { t, photoName } from './i18n.js';
import { GameTimer, formatTime, suggestedMinutes } from './timer.js';
import { listPuzzles, clearProgress, loadProgress, setUser, moveGuestDataToAccount, listAccountDays, addAccountDays } from './library.js';
import { daySeed, useAccountDays, takeGuestDays } from './daily.js';
import { setIcon } from './icons.js';
import { initHero } from './hero.js';
import { playIntro, introWillPlay, INTRO_REVEAL } from './intro.js';
import { initScrollPieces, initHeroDrift } from './scrollPieces.js';
import { createPhotoLibrary, fetchLibraryPhoto, loadLibrary } from './photoLibrary.js';
import { initAccount } from './account.js';
import { initSocial } from './social.js';
import { saver, scheduleSave, saveNow, photoBlobs, refreshResume, continueSaved } from './resumeCard.js';
import { refreshDaily, showDailyDone } from './dailyCard.js';
import { startMatch, finishMatch, showConnection } from './friendPlay.js';
import { saveToGallery, showGallery, showGalleryCount } from './galleryScreen.js';
import { starRating, showStars, showPersonalBest, showCompleteCard, hideCompleteCard } from './resultCard.js';
import { setMusicPanel, isMusicPanelOpen } from './musicPanel.js';
import { showTipsOnce, closeTips } from './settingsPanel.js';

const DEFAULT_PIECES = 144;
const SHARED_TABLE = { width: 1600, height: 1000 };
const PREVIEW_MAX_H = 260;

const setupScreen = screens.setup;
const gameScreen = screens.game;
const galleryScreen = screens.gallery;
const dropzone = $('dropzone');
const fileInput = $('file-input');
const photoInfo = $('photo-info');
const uploadError = $('upload-error');
const pieceGrid = $('piece-grid');
const laterSteps = [$('step-pieces'), $('step-table'), $('step-timer')];
const startBtn = $('start-btn');
const timeupCard = $('timeup-card');
const pauseCover = $('pause-cover');
const pauseBtn = $('pause-btn');
const hintBtn = $('hint-btn');
const undoBtn = $('undo-btn');
const edgesBtn = $('edges-btn');

/* ---------- Hero ---------- */

const scrollToSteps = () => $('setup-main').scrollIntoView({ behavior: 'smooth', block: 'start' });


// A reload during a game goes straight back to it (once the account is known), without the intro.
const openOnLoad = openGameOnLoad();
let reopening = openOnLoad;
const intro = introWillPlay() && !openOnLoad;
// The page stays hidden while the game opens; shown after a while whatever happens.
if (openOnLoad) setTimeout(() => document.documentElement.classList.remove('intro-pending'), 8000);

const account = initAccount({ onChange: accountChanged });
const social = initSocial({
  onPlay: startMatch,
  onGameEvent: (event) => state.match?.handle(event),
  onUserChange: (user) => account.update(user),
  onConnection: showConnection,
});

social.setPlaying(() => Boolean(state.match && !gameScreen.hidden));

// Signing in moves this browser's guest progress into the account; signing out shows the
// browser's own (guest) data again. Everything shown that depends on saved data is refreshed.
// It also runs once at start-up (signed in or not), which loads the gallery count, the
// Continue card and the daily card for the first time.
async function accountChanged(user) {
  setUser(user);
  social.setUser(user);
  $('privacy-note').lastElementChild.textContent = user
    ? t('start.puzzlesAreSavedPrivately')
    : t('start.photosStayDevice');
  if (user) {
    try {
      const guestDays = takeGuestDays();
      if (guestDays.length) await addAccountDays(guestDays);
      useAccountDays(await listAccountDays(), (day) => addAccountDays([day]).catch(() => {}));
      await moveGuestDataToAccount();
    } catch (err) {
      console.warn('Moving guest progress into the account stopped:', err.message);
    }
  } else {
    useAccountDays(null);
  }
  refreshResume();
  refreshDaily();
  if (reopening) reopenGame(reopening);
  reopening = null;
  listPuzzles().then((puzzles) => showGalleryCount(puzzles.length), () => showGalleryCount(0));
  if (!galleryScreen.hidden) showGallery();
}

async function reopenGame(open) {
  rememberOpenGame(null); // remembered again once the game is open, so a failure isn't retried
  try {
    if (open.kind === 'match') {
      await startMatch(open.id);
    } else {
      const saved = await loadProgress().catch(() => null);
      // Only the same puzzle: one closed before its first save leaves an older one there.
      if (saved?.seed === open.seed) await continueSaved();
    }
  } finally {
    document.documentElement.classList.remove('intro-pending'); // the page was kept hidden till now
  }
}

// The opening animation plays first; the hanging frames drop in as it clears.
initHero($('hero-cards'), $('hero-ghosts'), { delay: intro ? INTRO_REVEAL : 0 });
// The heading lines come in slowly, one after another, as the frames drop in.
if (intro) {
  gsap.from('.hero > *', {
    autoAlpha: 0, y: 26, duration: 1.8, stagger: 0.45, delay: INTRO_REVEAL + 0.4, ease: 'power2.out',
  });
}
if (!openOnLoad) playIntro();
initScrollPieces(() => !setupScreen.hidden); // small pieces fall down the margins while scrolling
// The rising pieces start once the frames have dropped in (about 2 s), one by one.
initHeroDrift($('hero-drift'), () => !setupScreen.hidden, { delay: (intro ? INTRO_REVEAL : 0) + 2 });

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
    uploadError.textContent = t('start.photoCouldnLoadedTry');
    uploadError.hidden = false;
  }
}, () => { $('photo-library').closest('.library').hidden = true; });
$('photo-library').append(library.element);

// Mystery puzzle: a random library photo (not the one already chosen), kept a secret.
async function startMystery() {
  const button = $('mystery-btn');
  button.disabled = true;
  try {
    const photos = await loadLibrary();
    const choices = photos.filter((p) => !state.mystery || p.name !== state.mystery.name);
    const pick = (choices.length ? choices : photos)[Math.floor(Math.random() * (choices.length || photos.length))];
    if (!pick) throw new Error('empty library');
    library.select(null);
    await handleFile(await fetchLibraryPhoto(pick), { mystery: { name: photoName(pick) } });
  } catch {
    uploadError.textContent = t('start.mysteryPhotoCouldnLoaded');
    uploadError.hidden = false;
  } finally {
    button.disabled = false;
  }
}
$('mystery-btn').addEventListener('click', startMystery);
$('mystery-peek').addEventListener('change', (e) => {
  if (state.mystery) state.mystery.allowPeek = e.target.checked;
});

// mystery: { name } to keep this photo a secret (a mystery puzzle).
async function handleFile(file, { mystery = null } = {}) {
  if (!file) return;
  uploadError.hidden = true;
  state.mystery = mystery ? { ...mystery, allowPeek: $('mystery-peek').checked } : null;

  try {
    const photo = await loadImageFile(file);
    tableTextureUrl(state.table); // a game is coming: get the table's texture ready meanwhile
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
  $('photo-name').textContent = state.mystery ? t('start.mysteryPuzzle') : photo.name;
  photoInfo.classList.toggle('mystery', Boolean(state.mystery));
  $('mystery-peek-row').hidden = !state.mystery;
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
  if (state.mystery) {
    // Only a heavy blur of the colours, so the picture stays a secret.
    ctx.filter = 'blur(18px) saturate(.7)';
    ctx.drawImage(source, -30, -30, w + 60, h + 60);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(30, 24, 40, .35)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.drawImage(source, 0, 0, w, h);
  }

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
  if (state.mystery) {
    ctx.fillStyle = 'rgba(255, 255, 255, .92)';
    ctx.font = `600 ${Math.round(Math.min(w, h) * 0.38)}px Fraunces, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', w / 2, h / 2);
  }

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
    : state.timer.mode === 'countdown' ? t('start.countdownMin', { a: state.timer.minutes }) : t('start.stopwatch');
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
  { name: t('start.quickBreak'), target: 24 },
  { name: t('start.settle'), target: 48 },
  { name: t('start.stayWhile'), target: 144 },
  { name: t('start.loseYourself'), target: 300 },
];

// Rough solving time for a pace card, e.g. "10 min" or "1 hour".
function aboutTime(pieceCount) {
  const minutes = suggestedMinutes(pieceCount);
  return minutes >= 60 && minutes % 60 === 0
    ? (minutes === 60 ? t('start.1Hour') : t('start.hours', { a: minutes / 60 }))
    : t('start.min', { a: minutes });
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
    if (unavailable) label.title = t('start.photoScreenTooSmall');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'pace';
    input.disabled = unavailable;
    input.addEventListener('change', () => selectPieces(option));
    const name = document.createElement('strong');
    name.textContent = pace.name;
    const detail = document.createElement('span');
    detail.textContent = unavailable ? t('start.notAvailableHere') : `${t('start.pieces2', { a: option.count })} · ${aboutTime(option.count)}`;
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
    t('start.pieceSummary', { a: count, b: cols, c: rows, d: Math.round(pieceW), e: Math.round(pieceH) });
  suggestTime(count);
  updateSummary();
}

/* ---------- Step 3: table ---------- */

// The table is remembered for next time, wherever it was picked.
function pickTable(id) {
  state.table = id;
  try {
    localStorage.setItem('puzzle-table', id);
  } catch {
    // Storage unavailable.
  }
  for (const picker of document.querySelectorAll('#setup-table-picker, #settings-tables')) {
    picker.replaceChildren(createTablePicker(id, pickTable));
  }
  tableTextureUrl(id); // start loading it now so it's ready when the game starts
  state.game?.setTable(id);
  updateSummary();
}

$('setup-table-picker').append(createTablePicker(state.table, pickTable));

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
  $('minutes-hint').textContent = t('start.suggestedPiecesMinutes', { a: pieceCount, b: minutes });
  if (!state.timer.minutesChosen) setMinutes(minutes);
}

/* ---------- Play ---------- */

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// The table size a saved game was played on, if it looks right.
function savedWorld(saved) {
  const { width, height } = saved?.world ?? {};
  const fine = (n) => Number.isFinite(n) && n >= 200 && n <= 10000;
  return fine(width) && fine(height) ? { width, height } : null;
}

// restore: a saved game from loadProgress(), to pick up where the player left off.
// match: a MatchSession when playing with a friend.
async function startGame({ restore = null, match = null } = {}) {
  stopGame();
  state.match = match;
  state.seed = restore?.seed ?? state.pendingSeed ?? Math.floor(Math.random() * 2 ** 31);
  state.pendingSeed = null;
  rememberOpenGame(match ? { kind: 'match', id: match.id } : { kind: 'saved', seed: state.seed });
  showScreen(gameScreen);
  showProgress(0);
  $('game-title').textContent = match ? t(`match.${match.mode}Pieces`, { a: match.friend, b: state.pieces.count })
    : state.mystery ? t('play.mysteryPuzzlePieces', { a: state.pieces.count }) : t('play.piecePuzzle', { a: state.pieces.count });
  $('reference-img').src = state.photo.url;
  // A mystery puzzle hides the reference picture unless peeking was allowed.
  referenceBtn.hidden = Boolean(state.mystery && !state.mystery.allowPeek);
  state.peeked = Boolean(restore?.peeked);

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
    autoPouch: Boolean(match?.live), // live games: the pouch opens for both at "Go!"
    shared: match?.mode === 'together' ? match.sharedHooks() : null,
    // Playing together, both screens show the same table: a fixed 16:10 one, scaled to fit.
    // A continued game gets back the table it was saved on (older saves: this screen's).
    worldSize: match?.mode === 'together' ? SHARED_TABLE : savedWorld(restore),
    onChange: match ? null : scheduleSave, // games with friends aren't saved for later
    onZoom: showZoom,
    announce: (text) => { $('announcer').textContent = text; },
    onSpill: () => {
      state.clock.start();
      setPlayControls(true);
      showTipsOnce();
      // A challenge's clock is kept by the server, from the first time the pieces came out.
      if (match?.mode === 'challenge') {
        match.beginChallenge().then((spent) => {
          state.clock?.pause();
          if (state.clock) state.clock.spent = Math.max(0, spent);
          state.clock?.start();
        }, () => {});
      }
    },
    onProgress: showProgress,
    onJoin: match ? (pieces) => match.reportJoin(pieces) : null,
    onComplete: () => {
      rememberOpenGame(null);
      if (match) return finishMatch(match);
      const { clock } = state;
      clock.pause();
      saver.stop();
      clearProgress().catch(() => {}).finally(refreshResume);
      showDailyDone(clock.elapsed, state.game.moves);
      const mysteryNote = $('mystery-note');
      mysteryNote.hidden = !state.mystery;
      if (state.mystery) {
        mysteryNote.textContent = t('play.mysteryRevealed', { a: state.mystery.name }) + (state.peeked ? '' : ` · ${t('play.solvedWithoutPeeking')}`);
      }
      setPlayControls(false);
      const spare = clock.remaining;
      $('stat-time').textContent = formatTime(clock.elapsed);
      $('stat-pieces').textContent = state.pieces.count;
      $('stat-extra-label').textContent = spare === null ? t('start.table') : t('play.spare');
      $('stat-extra').textContent = spare === null ? getTable(state.table).name : formatTime(spare);
      const { hintsUsed, moves } = state.game;
      $('stat-hints').textContent = hintsUsed === 0 ? t('play.none') : hintsUsed;
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
      showCompleteCard();
    },
  });
  loading.hidden = true;

  if (!match) saver.startGame(restore?.photo ? Promise.resolve(restore.photo) : photoBlobs(state.photo));
  if (match) {
    saver.stop();
    match.attach(state.game);
    if (match.live) match.ready().catch((err) => showToast(err.message, 6000));
    return;
  }
  if (restore) {
    state.game.moves = restore.moves ?? 0;
    state.game.hintsUsed = restore.hintsUsed ?? 0;
    showProgress(state.game.progress(), state.game.connectedPieces(), state.game.puzzle.pieces.length);
    state.clock.start();
    setPlayControls(true);
  }
}

// Tears down the current game (if any) and hides all of its cards.
function stopGame() {
  hideCompleteCard();
  closeTips();
  showZoom(1);
  state.match?.destroy();
  state.match = null;
  $('connection-banner').hidden = true;
  $('match-note').hidden = true;
  edgesBtn.setAttribute('aria-pressed', 'false');
  state.clock?.pause();
  state.clock = null;
  state.game?.destroy();
  state.game = null;
  timeupCard.hidden = true;
  pauseCover.hidden = true;
  showPauseButton(false);
  setReference(false);
  setPopoverOpen(false);
}

function leaveGame() {
  rememberOpenGame(null);
  saveNow().finally(refreshResume);
  stopGame();
  if (document.fullscreenElement) document.exitFullscreen();
  showScreen(setupScreen);
  drawPreview();
}

const MILESTONES = [
  [25, t('play.quarterDoneNiceSteady')],
  [50, t('play.halfwayThereTakeTime')],
  [75, t('play.threeQuartersDoneAlmost')],
];
let milestonesShown = new Set();
let toastTimer = null;

function showProgress(share, connected = 0, total = state.pieces?.count ?? 0) {
  const percent = Math.floor(share * 100);
  $('progress-fill').style.width = `${percent}%`;
  $('progress-text').textContent = `${percent}%`;
  $('progress').title = t('play.piecesConnected', { a: connected, b: total });

  if (share === 0) milestonesShown = new Set();
  for (const [at, message] of MILESTONES) {
    if (percent >= at && percent < 100 && !milestonesShown.has(at)) {
      milestonesShown.add(at);
      showToast(message);
    }
  }
}

function showToast(message, duration = 2800) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
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
// The zoom buttons in the corner of the table.
function showZoom(zoom = 1) {
  $('zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  $('zoom-out').disabled = zoom <= 1.001;
  $('zoom-fit').disabled = zoom <= 1.001;
  $('zoom-in').disabled = zoom >= MAX_ZOOM - 0.001;
}
$('zoom-in').addEventListener('click', () => state.game?.zoomBy(1.5, undefined, undefined, { animate: true }));
$('zoom-out').addEventListener('click', () => state.game?.zoomBy(1 / 1.5, undefined, undefined, { animate: true }));
$('zoom-fit').addEventListener('click', () => state.game?.resetView());

// Games with a friend can't be paused (the friend's clock keeps going), and a shared table has no undo.
function setPlayControls(enabled) {
  $('zoom-controls').hidden = !enabled;
  pauseBtn.disabled = !enabled || Boolean(state.match);
  hintBtn.disabled = !enabled;
  undoBtn.disabled = !enabled || state.match?.mode === 'together';
  edgesBtn.disabled = !enabled;
  pauseBtn.hidden = Boolean(state.match);
  undoBtn.hidden = state.match?.mode === 'together';
  $('replay-btn').hidden = Boolean(state.match);
  $('match-games-btn').hidden = !state.match;
  $('rematch-btn').hidden = !state.match;
  $('react-wrap').hidden = !state.match?.live;
}

function setEdgesOnly(on) {
  edgesBtn.setAttribute('aria-pressed', String(on));
  state.game?.setEdgesOnly(on);
}

undoBtn.addEventListener('click', () => state.game?.undo());
edgesBtn.addEventListener('click', () => setEdgesOnly(edgesBtn.getAttribute('aria-pressed') !== 'true'));

function showPauseButton(paused) {
  setIcon(pauseBtn.querySelector('svg'), paused ? 'i-play' : 'i-pause');
  pauseBtn.title = paused ? t('play.resumeP') : t('play.pauseP');
  pauseBtn.setAttribute('aria-label', pauseBtn.title);
}

function timeUp() {
  state.game.setPaused(true);
  setPlayControls(false);
  const percent = Math.round(state.game.progress() * 100);
  $('timeup-text').textContent = t('play.gotPuzzleDoneKeep', { a: percent });
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
  if (document.hidden && state.clock?.running && !state.match) setPaused(true);
});

/* ---------- Toolbar tools ---------- */

const referenceBtn = $('reference-btn');

function setReference(show) {
  if (show && referenceBtn.hidden) return;
  if (show && state.mystery) state.peeked = true;
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
  soundBtn.title = on ? t('play.sound2') : t('play.soundOff');
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
  fullscreenBtn.title = on ? t('play.exitFullScreenF') : t('play.fullScreenF');
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
  else if (key === 'm') setMusicPanel(!isMusicPanelOpen());
  else if (key === 'f' && document.fullscreenEnabled) toggleFullscreen();
  else if ((key === '+' || key === '=') && state.game) state.game.zoomBy(1.5, undefined, undefined, { animate: true });
  else if ((key === '-' || key === '_') && state.game) state.game.zoomBy(1 / 1.5, undefined, undefined, { animate: true });
  else if (key === '0' && state.game) state.game.resetView();
});

/* ---------- Works offline after the first visit (see sw.js) ---------- */

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {}); // without it, everything still works online
}

/* ---------- What the other parts of the app may call ---------- */

Object.assign(app, {
  startGame, stopGame, leaveGame, showToast, setPlayControls, showPhoto, showPieceOptions, drawPreview,
  handleFile, pickTable, showSound, social, library,
});
