// Games with a friend, on this side: opening one, the result when it's done, reactions, and the
// "connection lost" banner. The live part of a game is in multiplayer.js.

import { $, app, state, screens } from './app.js';
import { MatchSession, resultLine } from './multiplayer.js';
import { MODE_NAMES } from './social.js';
import { api, apiBlob } from './api.js';
import { fetchLibraryPhoto, loadLibrary } from './photoLibrary.js';
import { loadImageFile, analyzeResolution } from './imageLoader.js';
import { formatTime } from './timer.js';
import { starRating, showStars, showCompleteCard } from './resultCard.js';
import { saveToGallery } from './galleryScreen.js';

// While playing with a friend, say so when the connection drops, and catch up once it's back.
export function showConnection(online) {
  const banner = $('connection-banner');
  const live = state.match?.live && !screens.game.hidden;
  banner.hidden = online || !live;
  if (online && live) state.match.resync();
}


// Opens a game with a friend: loads its puzzle (the same cut on both screens) and its table.
export async function startMatch(matchId) {
  let match;
  try {
    ({ match } = await api(`match/${matchId}`));
    if (match.status === 'invited') throw new Error(`${match.friend.username} hasn't answered yet.`);
    if (match.status !== 'accepted' || !match.puzzle) throw new Error('This game is over.');
    const { puzzle } = match;
    const listed = puzzle.libraryId && (await loadLibrary()).find((p) => p.id === puzzle.libraryId);
    const file = puzzle.libraryId
      ? await fetchLibraryPhoto(listed ?? { id: puzzle.libraryId, name: puzzle.name })
      : new File([await apiBlob(`match/${matchId}/photo`)], `${puzzle.name}.jpg`, { type: 'image/jpeg' });
    const photo = await loadImageFile(file);
    photo.name = puzzle.name;
    photo.quality = analyzeResolution(photo.width, photo.height);
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    state.photo = photo;
    state.pieces = { count: puzzle.cols * puzzle.rows, cols: puzzle.cols, rows: puzzle.rows, pace: null };
    state.timer = { ...state.timer, mode: 'stopwatch' };
    state.daily = null;
    state.mystery = null;
    state.pendingSeed = puzzle.seed;
  } catch (err) {
    app.social.notice(err.message);
    return;
  }
  const session = new MatchSession(match, {
    onStart: (startAt) => {
      // Both clocks count from the same moment, the server's "Go!".
      const { clock } = state;
      if (!clock || state.match !== session) return;
      clock.pause();
      clock.spent = Math.max(0, session.serverNow() - startAt);
      clock.start();
      app.setPlayControls(true);
    },
    onFriendFinished: (timeMs) => {
      if (state.match === session && !state.game?.ready) return;
      app.showToast(`${session.friend} finished first in ${formatTime(timeMs)}. Finish yours for fun!`, 6000);
    },
    onConnection: showConnection,
    onReaction: (reaction) => showReaction(REACTIONS[reaction], session.friend),
    onEnded: () => app.showToast(`This game with ${session.friend} has ended.`, 6000),
    onFriendLeft: () => {
      if (state.match !== session) return;
      const message = session.mode === 'together'
        ? `${session.friend} left the table. You can finish on your own.`
        : session.mode === 'race' && session.started ? `${session.friend} gave up. You win the race!` : `${session.friend} left the game.`;
      app.showToast(message, 6000);
    },
  });
  app.showPhoto(state.photo);
  await app.startGame({ match: session });
}

// The puzzle is done: the server measures the time and says who won; then the usual card.
export async function finishMatch(match) {
  const { clock, game } = state;
  clock.pause();
  app.setPlayControls(false);
  const stars = starRating(state.pieces.count, game.moves, game.hintsUsed);
  // After any drop still on its way, so playing together the server has seen the last join.
  // (The last join finishes the puzzle before its drop is queued, hence the wait for the next tick.)
  await new Promise((resolve) => setTimeout(resolve));
  const reply = await match.enqueue(() => match.finish({ stars, moves: game.moves, hints: game.hintsUsed })).catch(() => null);
  const details = await match.details().catch(() => null);
  if (state.match !== match) return;
  const timeMs = reply?.timeMs ?? clock.elapsed;
  $('stat-time').textContent = formatTime(timeMs);
  $('stat-pieces').textContent = state.pieces.count;
  $('stat-extra-label').textContent = 'Game';
  $('stat-extra').textContent = MODE_NAMES[match.mode];
  $('stat-extra').classList.add('long'); // "Together" is wider than a number
  $('stat-hints').textContent = game.hintsUsed === 0 ? 'None' : game.hintsUsed;
  $('stat-moves').textContent = game.moves;
  showStars(stars);
  $('daily-note').hidden = true;
  $('mystery-note').hidden = true;
  $('best-badge').hidden = true;
  $('saved-note').replaceChildren();
  $('new-medals').replaceChildren();
  const note = $('match-note');
  note.textContent = resultLine(match, details, reply);
  note.classList.toggle('won', /^You won/.test(note.textContent));
  note.hidden = false;
  saveToGallery({ timeMs, limitMs: null, beatClock: false, hintsUsed: game.hintsUsed, moves: game.moves, stars });
  app.social.refreshMatches();
  showCompleteCard();
}

// Quick reactions during a live game with a friend.
const REACTIONS = ['👍', '👏', '🎉', '😄', '😮', '❤️'];
const reactMenu = $('react-menu');
reactMenu.replaceChildren(...REACTIONS.map((emoji, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = emoji;
  b.setAttribute('role', 'menuitem');
  b.addEventListener('click', () => {
    state.match?.react(i);
    showReaction(emoji, null);
    setReactMenu(false);
  });
  return b;
}));
function setReactMenu(open) {
  reactMenu.hidden = !open;
  $('react-btn').setAttribute('aria-expanded', String(open));
}
$('react-btn').addEventListener('click', () => setReactMenu(reactMenu.hidden));
document.addEventListener('click', (e) => { if (!e.target.closest('#react-wrap')) setReactMenu(false); });

// A reaction floats up from the bottom of the table: big for the friend's, small for one's own.
function showReaction(emoji, from) {
  if (!emoji || screens.game.hidden) return;
  const bubble = document.createElement('div');
  bubble.className = `reaction${from ? '' : ' mine'}`;
  bubble.textContent = emoji;
  if (from) {
    const name = document.createElement('span');
    name.textContent = from;
    bubble.append(name);
  }
  bubble.style.left = `${from ? 38 + Math.random() * 24 : 78 + Math.random() * 8}%`;
  screens.game.append(bubble);
  bubble.addEventListener('animationend', () => bubble.remove());
  setTimeout(() => bubble.remove(), 4000);
}

$('rematch-btn').addEventListener('click', () => {
  const match = state.match;
  if (!match) return;
  const { friend, mode, picks, pieces } = match.match;
  app.leaveGame();
  app.social.rematch(friend, { mode, picks, pieces });
});

$('match-games-btn').addEventListener('click', () => {
  app.leaveGame();
  app.social.open('games');
});

