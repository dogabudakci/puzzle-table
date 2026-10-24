// The gallery room: finished puzzles hang in frames on the wall, achievements stand on a shelf.

import { ACHIEVEMENTS } from './achievements.js';
import { formatTime } from './timer.js';
import { getTable } from './textures.js';
import { icon } from './icons.js';

const imageUrls = new Set();

function imageUrl(blob) {
  const url = URL.createObjectURL(blob);
  imageUrls.add(url);
  return url;
}

function releaseImages() {
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
}

// Harder puzzles get finer frames.
function frameMaterial(pieces) {
  if (pieces >= 300) return 'gold';
  if (pieces >= 150) return 'silver';
  if (pieces >= 50) return 'black';
  return 'oak';
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function createFrame(puzzle) {
  const frame = document.createElement('div');
  frame.className = `frame ${frameMaterial(puzzle.pieces)}`;
  const mat = document.createElement('div');
  mat.className = 'frame-mat';
  const img = document.createElement('img');
  img.src = puzzle.imageUrl ?? imageUrl(puzzle.image); // account pictures load from the server
  img.width = puzzle.imageW;
  img.height = puzzle.imageH;
  img.alt = puzzle.name;
  img.decoding = 'async';
  mat.append(img);
  frame.append(mat);
  return frame;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Fills the room. `earned` is a Map of achievement id → earnedAt.
export function renderGallery({ puzzles, earned, shelf, frames, emptyNote, stats, onOpen }) {
  releaseImages();

  shelf.replaceChildren(...ACHIEVEMENTS.map((a) => {
    const has = earned.has(a.id);
    const medal = el('div', `medal${has ? '' : ' locked'}`);
    medal.title = has ? `${a.hint} · earned ${dateFormat.format(earned.get(a.id))}` : a.hint;
    const coin = el('div', 'coin');
    coin.append(icon(has ? a.icon : 'i-lock', 'coin-icon'));
    medal.append(coin, el('div', 'medal-name', a.name), el('div', 'medal-hint', has ? 'Earned' : a.hint));
    return medal;
  }));

  const newestFirst = [...puzzles].sort((a, b) => b.createdAt - a.createdAt);
  frames.replaceChildren(...newestFirst.map((puzzle) => {
    const hung = el('button', 'hung');
    hung.type = 'button';
    hung.setAttribute('aria-label', `${puzzle.name}, ${puzzle.pieces} pieces. Open`);
    const plaque = el('div', 'plaque');
    plaque.append(
      el('strong', '', `${puzzle.pieces} pieces · ${formatTime(puzzle.timeMs)}`),
      el('span', '', dateFormat.format(puzzle.createdAt)),
    );
    hung.append(createFrame(puzzle), plaque);
    hung.addEventListener('click', () => onOpen(puzzle));
    return hung;
  }));
  emptyNote.hidden = puzzles.length > 0;

  const totalPieces = puzzles.reduce((sum, p) => sum + p.pieces, 0);
  const totalTime = puzzles.reduce((sum, p) => sum + p.timeMs, 0);
  const stat = (value, label) => {
    const item = el('div', 'gallery-stat');
    item.append(el('strong', '', value), el('span', '', label));
    return item;
  };
  stats.replaceChildren(
    stat(String(puzzles.length), puzzles.length === 1 ? 'puzzle' : 'puzzles'),
    stat(String(totalPieces), 'pieces'),
    stat(formatTime(totalTime), 'total time'),
    stat(`${earned.size}/${ACHIEVEMENTS.length}`, 'achievements'),
  );
}

// Fills the close-up view of one puzzle.
export function renderViewer(container, puzzle) {
  const details = el('dl', 'viewer-details');
  const add = (label, value) => details.append(el('dt', '', label), el('dd', '', value));
  add('Pieces', `${puzzle.pieces} (${puzzle.cols} × ${puzzle.rows})`);
  add('Time', formatTime(puzzle.timeMs));
  if (puzzle.limitMs) {
    add('Countdown', `${Math.round(puzzle.limitMs / 60000)} min · ${puzzle.beatClock ? 'beat the clock ✓' : 'finished after time ran out'}`);
  }
  // Puzzles saved before hints existed have no count.
  if (puzzle.hintsUsed !== undefined) {
    add('Hints', puzzle.hintsUsed === 0 ? 'None, solved unaided' : String(puzzle.hintsUsed));
  }
  add('Table', getTable(puzzle.table).name);
  add('Finished', dateFormat.format(puzzle.createdAt));

  container.replaceChildren(createFrame(puzzle), el('h2', 'viewer-title', puzzle.name), details);
}
