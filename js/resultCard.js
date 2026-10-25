// The "Puzzle complete" card: stars, a personal best, and when the card appears.

import { $, state } from './app.js';
import { listPuzzles } from './library.js';
import { formatTime } from './timer.js';
import { icon } from './icons.js';

const completeCard = $('complete-card');
let cardTimer = null;

// 3 stars, minus one for leaning on hints and one for many more moves than pieces.
export function starRating(pieceCount, moves, hintsUsed) {
  let stars = 3;
  if (hintsUsed > Math.max(1, Math.round(pieceCount / 40))) stars--;
  if (moves > pieceCount * 1.6) stars--;
  return Math.max(1, stars);
}

export function showStars(stars) {
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
export async function showPersonalBest(pieceCount, timeMs) {
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


// Lets the light sweep and the frame finish (3 s) before the card appears, beside the puzzle
// when the table is wide enough for both.
export function showCompleteCard() {
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => {
    completeCard.classList.toggle('beside', $('table').clientWidth >= 1000);
    completeCard.hidden = false;
    state.game?.makeRoomForCard(completeCard);
  }, 3000);
}

export function hideCompleteCard() {
  clearTimeout(cardTimer);
  completeCard.hidden = true;
  completeCard.classList.remove('beside');
  $('stat-extra').classList.remove('long');
}
