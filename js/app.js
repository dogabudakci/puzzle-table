// What the parts of the app share: the current puzzle's state, a shortcut for finding elements,
// the three screens, and the few functions one part offers the others. Each part registers its
// functions on `app` when it loads (main.js wires them up), and calls the others' only later,
// in response to something happening, so the order the files load in doesn't matter.

import { DEFAULT_TABLE, getTable } from './textures.js';
import { setHeroRunning } from './hero.js';
import { clearScrollPieces } from './scrollPieces.js';

export const $ = (id) => document.getElementById(id);

export const state = {
  photo: null,  // { name, url, width, height, canvas, quality }
  pieces: null, // { count, cols, rows, pieceW, pieceH }
  table: savedTable(),
  timer: { mode: 'stopwatch', minutes: 10, minutesChosen: false },
  game: null,
  clock: null,  // GameTimer of the running game
  seed: null,         // the cut of the running game, so it can be saved and restored
  gameId: null,       // this puzzle's own id: its saves never replace another puzzle's
  pendingSeed: null,  // set before startGame() to use a particular cut (the daily puzzle)
  daily: null,        // the day key while playing that day's daily puzzle
  mystery: null,      // { name, allowPeek } while the photo is a secret library pick
  peeked: false,      // the reference picture was looked at during a mystery puzzle
  match: null,        // MatchSession while playing with a friend
};

export const screens = { setup: $('setup'), game: $('game'), gallery: $('gallery') };

export function showScreen(screen) {
  for (const s of Object.values(screens)) s.hidden = s !== screen;
  setHeroRunning(screen === screens.setup); // the floating cards rest while out of sight
  if (screen !== screens.setup) clearScrollPieces();
}

// Filled in by main.js: startGame, stopGame, leaveGame, showToast, setPlayControls, showPhoto,
// showPieceOptions, drawPreview, handleFile, pickTable, showSound, social, library.
export const app = {};

function savedTable() {
  try {
    const id = localStorage.getItem('puzzle-table');
    return id && getTable(id).id === id ? id : DEFAULT_TABLE;
  } catch {
    return DEFAULT_TABLE;
  }
}

// The game open in this tab, so that reloading the page goes straight back to it:
// { kind: 'saved', seed } for a puzzle saved for later, { kind: 'match', id } for one with a friend.
const OPEN_GAME_KEY = 'puzzle-open-game';

export function rememberOpenGame(game) {
  try {
    if (game) sessionStorage.setItem(OPEN_GAME_KEY, JSON.stringify(game));
    else sessionStorage.removeItem(OPEN_GAME_KEY);
  } catch {
    // Storage unavailable: a reload shows the start page.
  }
}

export function openGameOnLoad() {
  try {
    return JSON.parse(sessionStorage.getItem(OPEN_GAME_KEY));
  } catch {
    return null;
  }
}

// Shows a message where the photo is chosen (e.g. when a puzzle couldn't be loaded).
export function showUploadError(text) {
  $('upload-error').textContent = text;
  $('upload-error').hidden = false;
}
