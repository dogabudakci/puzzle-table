// Opening animation: loose jigsaw pieces appear in the middle of the screen and straight away
// drift slowly apart to every side of the window, turning in 3D, while the page fades in behind them (GSAP).
// The puzzle is never shown whole: the pieces appear already loose and spread out.
// The pieces come from the same cutter as the game, so they are real interlocking shapes.

import { cutPuzzle, seededRandom } from './cutter.js';
import { gridFor } from './pieceOptions.js';

// Everything worth tweaking lives here.
const INTRO = {
  photo: 'assets/intro.jpg',
  pieces: 160,         // aimed for; the grid that fits the photo's shape is used
  maxWidth: 940,       // puzzle size on screen, px
  screenShare: 0.72,   // …but at most this share of the window's width and height
  looseness: 1.45,     // how spread out the pieces start (1 = touching, as in the finished puzzle)
  wander: 40,          // px: random offset of each piece at the start
  appear: 0.4,         // s: all pieces fade in together, already moving
  drift: [3, 4.2],      // s: how long one piece takes to drift off the window
  spread: 0.15,        // s: the outer pieces leave this much before the centre ones
  jitter: 0.5,         // radians: how far a piece may stray from moving straight outward
  nearShare: 0.25,     // share of pieces that drift towards the viewer
  reveal: 0.6,         // s: when the page starts showing through
};

// Seconds from the start until the page begins to show through (for timing what comes next).
export const INTRO_REVEAL = INTRO.reveal;

export function introWillPlay() {
  return Boolean(window.gsap) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const rand = (min, max) => min + Math.random() * (max - min);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Plays the intro once; `onReveal` runs when the page starts showing through.
// Resolves when the animation is over (or straight away if it can't or shouldn't play).
export async function playIntro({ onReveal } = {}) {
  const gsap = window.gsap;
  const unhide = () => document.documentElement.classList.remove('intro-pending');
  if (!introWillPlay()) {
    unhide();
    onReveal?.();
    return;
  }

  // Cover the page straight away so it doesn't flash before the puzzle appears.
  const overlay = document.createElement('div');
  overlay.className = 'intro';
  overlay.setAttribute('aria-hidden', 'true');
  const backdrop = document.createElement('div');
  backdrop.className = 'intro-backdrop';
  const stage = document.createElement('div');
  stage.className = 'intro-stage';
  overlay.append(backdrop, stage);
  document.body.append(overlay);
  unhide(); // the overlay covers the page now

  let img;
  try {
    img = await loadImage(INTRO.photo);
  } catch {
    overlay.remove();
    onReveal?.();
    return;
  }

  const aspect = img.naturalWidth / img.naturalHeight;
  const width = Math.round(Math.min(INTRO.maxWidth, innerWidth * INTRO.screenShare, innerHeight * INTRO.screenShare * aspect));
  const height = Math.round(width / aspect);
  const { cols, rows } = gridFor(INTRO.pieces, aspect);
  const puzzle = cutPuzzle(img, cols, rows, width, height, seededRandom(7));

  const board = document.createElement('div');
  board.className = 'intro-puzzle';
  board.style.width = `${width}px`;
  board.style.height = `${height}px`;
  for (const piece of puzzle.pieces) {
    piece.canvas.className = 'intro-piece';
    piece.canvas.style.left = `${piece.ox}px`;
    piece.canvas.style.top = `${piece.oy}px`;
    board.append(piece.canvas);
  }
  stage.append(board);

  // Where the puzzle sits on screen, to know how far each piece has to go to leave the window.
  const boardLeft = (innerWidth - width) / 2;
  const boardTop = (innerHeight - height) / 2;
  const tl = gsap.timeline();
  tl.call(() => onReveal?.(), null, INTRO.reveal);
  tl.to(backdrop, { autoAlpha: 0, duration: 2.2, ease: 'sine.inOut' }, INTRO.reveal);

  for (const piece of puzzle.pieces) {
    const el = piece.canvas;
    // Piece centre relative to the puzzle centre, -1 … 1 on each axis.
    const nx = ((piece.col + 0.5) / cols) * 2 - 1;
    const ny = ((piece.row + 0.5) / rows) * 2 - 1;
    const fromCentre = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2);

    // Start loose: pushed out from the centre, nudged at random, tilted and at its own depth.
    const startX = nx * (width / 2) * (INTRO.looseness - 1) + rand(-INTRO.wander, INTRO.wander);
    const startY = ny * (height / 2) * (INTRO.looseness - 1) + rand(-INTRO.wander, INTRO.wander);
    const near = Math.random() < INTRO.nearShare;
    gsap.set(el, {
      x: startX, y: startY, z: rand(-60, 60),
      rotation: rand(-18, 18), rotationX: rand(-15, 15), rotationY: rand(-15, 15),
      autoAlpha: 0,
    });

    // 1. Appear: all pieces fade in at once while they start moving.
    tl.to(el, { autoAlpha: 1, duration: INTRO.appear, ease: 'sine.out' }, 0);

    // 2. Drift apart: outward from the centre (centre pieces pick any direction), slowly.
    const outward = fromCentre < 0.15 ? rand(0, Math.PI * 2) : Math.atan2(ny, nx);
    const angle = outward + rand(-INTRO.jitter, INTRO.jitter);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = boardLeft + piece.ox + startX + el.offsetWidth / 2;
    const py = boardTop + piece.oy + startY + el.offsetHeight / 2;
    const toEdgeX = dx > 0 ? (innerWidth - px) / dx : dx < 0 ? -px / dx : Infinity;
    const toEdgeY = dy > 0 ? (innerHeight - py) / dy : dy < 0 ? -py / dy : Infinity;
    const distance = Math.min(toEdgeX, toEdgeY) + rand(150, 300);

    const start = (1 - fromCentre) * INTRO.spread + rand(0, 0.1);
    const duration = rand(...INTRO.drift);
    tl.to(el, {
      x: `+=${dx * distance}`, y: `+=${dy * distance}`,
      rotation: `+=${rand(60, 160) * (Math.random() < 0.5 ? -1 : 1)}`,
      rotationX: rand(-60, 60), rotationY: rand(-60, 60),
      z: near ? rand(250, 450) : rand(-150, 40),
      duration, ease: 'power1.out',
    }, start);
    tl.to(el, { autoAlpha: 0, duration: duration * 0.3, ease: 'sine.in' }, start + duration * 0.7);
  }

  // A click skips straight to the end.
  overlay.addEventListener('pointerdown', () => tl.progress(1), { once: true });
  await new Promise((resolve) => tl.eventCallback('onComplete', () => { overlay.remove(); resolve(); }));
}

// A small floating button that replays the intro, for trying out changes.
export function addReplayButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'intro-replay';
  button.textContent = 'Replay intro';
  let playing = false;
  button.addEventListener('click', async () => {
    if (playing) return;
    playing = true;
    await playIntro();
    playing = false;
  });
  document.body.append(button);
  return button;
}
