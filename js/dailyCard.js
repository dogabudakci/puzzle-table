// The daily puzzle card: today's photo, the streak and calendar, and the friends' ranking.

import { $, app, state, showUploadError } from './app.js';
import { saveDailyResult, dailyBoard } from './library.js';
import { DAILY_PIECES, dayKey, daySeed, dailyPhoto, doneDays, markDone, streak, msUntilTomorrow, renderCalendar } from './daily.js';
import { fetchLibraryPhoto, loadLibrary, libraryThumbUrl } from './photoLibrary.js';
import { loadImageFile, analyzeResolution } from './imageLoader.js';
import { pieceOptions } from './pieceOptions.js';
import { formatTime } from './timer.js';
import { icon } from './icons.js';
import { t, photoName } from './i18n.js';


let dailyToday = null; // { key, photo } for today's daily puzzle
let dailyCountdown = null;

export async function refreshDaily() {
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

  $('daily-img').src = libraryThumbUrl(photo);
  showDailyBoard(key);
  $('daily-title').textContent = photoName(photo);
  $('daily-date').textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const streakEl = $('daily-streak');
  streakEl.classList.toggle('cold', run === 0);
  streakEl.replaceChildren(icon('i-flame'), run > 0 ? t('daily.dayStreak', { a: run }) : t('daily.startStreakToday'));

  const button = $('daily-btn');
  button.classList.toggle('done', doneToday);
  button.disabled = doneToday;
  clearInterval(dailyCountdown);
  if (doneToday) {
    const showNext = () => {
      const ms = msUntilTomorrow();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor(ms / 60000) % 60;
      $('daily-message').textContent = t('daily.lovelyWorkNewPuzzle', { a: h, b: m });
      if (dayKey() !== key) refreshDaily(); // midnight passed while the page was open
    };
    showNext();
    dailyCountdown = setInterval(showNext, 30000);
    button.replaceChildren(icon('i-check'), t('daily.doneToday'));
  } else {
    $('daily-message').textContent = run > 0
      ? t('daily.playTodayKeepDay', { a: run })
      : t('daily.newPiecePuzzleEvery', { a: DAILY_PIECES });
    button.textContent = t('daily.playTodayPuzzle');
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
    app.showPhoto(photo);
    app.showPieceOptions();
    app.library.select(libraryPhoto.id);
    // The daily size, or the closest the screen allows.
    const options = pieceOptions(photo.width, photo.height, window.innerWidth, window.innerHeight)
      .filter((o) => !o.disabledReason);
    const option = options.reduce((best, o) =>
      Math.abs(o.count - DAILY_PIECES) < Math.abs(best.count - DAILY_PIECES) ? o : best);
    state.pieces = { count: option.count, cols: option.cols, rows: option.rows, pieceW: option.pieceW, pieceH: option.pieceH, pace: null };
    state.timer = { ...state.timer, mode: 'stopwatch' };
    state.daily = key;
    state.mystery = null;
    state.pendingSeed = daySeed(key);
    await app.startGame();
  } catch {
    showUploadError(t('daily.todayPuzzleCouldnLoaded'));
  } finally {
    refreshDaily();
  }
}

// On the complete card: mark the day done and celebrate the streak, and (signed in) where
// this time ranks among friends today.
export function showDailyDone(timeMs, moves) {
  const note = $('daily-note');
  note.hidden = true;
  if (!state.daily) return;
  const day = state.daily;
  const days = markDone(day);
  const run = streak(days);
  const text = run > 1 ? t('daily.doneStreak', { a: run }) : t('daily.doneStreakStarted');
  note.replaceChildren(icon('i-flame'), text);
  note.hidden = false;
  saveDailyResult(day, timeMs, moves)
    .then(() => dailyBoard(day))
    .then((board) => {
      const place = board.findIndex((row) => row.me) + 1;
      if (place && board.length > 1 && state.daily === day) {
        note.replaceChildren(icon('i-flame'), `${text} · ${t('daily.friendsToday', { a: place, b: board.length })}`);
      }
      refreshDaily();
    })
    .catch(() => refreshDaily());
}

// The top times among friends for today's puzzle, under the daily card's button.
async function showDailyBoard(day) {
  const list = $('daily-board');
  const board = await dailyBoard(day).catch(() => []);
  list.hidden = board.length < 2; // a ranking needs at least two
  list.replaceChildren(...board.slice(0, 5).map((row, i) => {
    const item = document.createElement('li');
    item.classList.toggle('me', row.me);
    const rank = document.createElement('span');
    rank.textContent = `${i + 1}`;
    const name = document.createElement('span');
    name.textContent = row.me ? t('daily.text') : row.username;
    const time = document.createElement('strong');
    time.textContent = formatTime(row.timeMs);
    item.append(rank, name, time);
    return item;
  }));
}

$('daily-btn').addEventListener('click', startDaily);

