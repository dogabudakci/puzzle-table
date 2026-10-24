// Small jigsaw pieces that fall down the left and right edges of the start page while the user
// scrolls: scrolling down drops them from the top, scrolling up sends them rising from the
// bottom. They are cut from the library photos, and stay in the margins beside the content.

import { cutPuzzle, seededRandom } from './cutter.js';

// Everything worth tweaking lives here.
const SCROLL_PIECES = {
  photos: ['assets/library/oia.jpg', 'assets/library/orchids.jpg', 'assets/library/cinque-terre.jpg', 'assets/library/lake-pier.jpg'],
  size: [22, 38],      // px: piece size
  every: 70,           // px scrolled per new piece (on each side, alternating)
  maxOnScreen: 26,
  fall: [1.6, 2.6],    // s: time to cross the window; faster scrolling shortens it
  contentWidth: 1120,  // the page column the pieces keep clear of
  minMargin: 70,       // px: margin width used when the window is narrower than the column
};

// The hero's slowly rising pieces.
const HERO_DRIFT = {
  size: [24, 40],      // px
  rise: [10, 16],      // s: time to float from the bottom of the hero to the top
  every: 0.8,          // s between new pieces
  maxOnScreen: 20,
  textColumn: 640,     // px: the heading's column, kept clear on wide screens
};

const rand = (min, max) => min + Math.random() * (max - min);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// A pool of loose pieces: each photo is cut once into a small puzzle and every piece kept.
async function cutPool() {
  const images = await Promise.all(SCROLL_PIECES.photos.map((src) => loadImage(src).catch(() => null)));
  const pool = [];
  images.filter(Boolean).forEach((img, i) => {
    const cols = 6;
    const rows = 4;
    const pieceSize = SCROLL_PIECES.size[1];
    const puzzle = cutPuzzle(img, cols, rows, cols * pieceSize, rows * pieceSize, seededRandom(31 + i));
    for (const piece of puzzle.pieces) pool.push(piece.canvas);
  });
  return pool;
}

let poolPromise = null;
const sharedPool = () => (poolPromise ??= cutPool());

// Small photo pieces rising slowly through the hero, behind the frames and heading, all the time.
// `layer` is positioned over the hero; `delay` waits for the intro.
export async function initHeroDrift(layer, isActive, { delay = 0 } = {}) {
  const gsap = window.gsap;
  if (!gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pool = await sharedPool();
  if (!pool.length) return;
  let onScreen = 0;

  function launch() {
    if (!isActive() || onScreen >= HERO_DRIFT.maxOnScreen) return;
    const source = pool[Math.floor(Math.random() * pool.length)];
    const el = copyPiece(source, rand(...HERO_DRIFT.size));
    const w = parseFloat(el.style.width);
    // On wide screens keep clear of the centred heading; it's too narrow for that on phones.
    const full = layer.clientWidth;
    const clear = full >= 1000 ? HERO_DRIFT.textColumn / 2 + 30 : 0;
    const sideWidth = Math.max(0, full / 2 - clear - w);
    const offset = rand(0, sideWidth);
    el.style.left = `${clear ? (Math.random() < 0.5 ? offset : full - offset - w) : rand(0, Math.max(0, full - w))}px`;
    layer.append(el);
    onScreen++;

    const height = layer.clientHeight;
    const duration = rand(...HERO_DRIFT.rise);
    gsap.set(el, { y: height + 30, rotation: rand(0, 360), autoAlpha: 0 });
    gsap.to(el, { autoAlpha: rand(0.55, 0.9), duration: 1.5 });
    gsap.to(el, { autoAlpha: 0, duration: 1.5, delay: duration - 1.5 });
    gsap.to(el, { x: `+=${rand(-60, 60)}`, duration: duration / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 });
    gsap.to(el, {
      y: -60, rotation: `+=${rand(90, 220) * (Math.random() < 0.5 ? -1 : 1)}`,
      rotationX: rand(-40, 40), rotationY: rand(-40, 40),
      duration, ease: 'none',
      onComplete: () => { el.remove(); onScreen--; },
    });
  }

  gsap.delayedCall(delay, () => {
    launch();
    gsap.to({}, { duration: HERO_DRIFT.every, repeat: -1, onRepeat: launch });
  });
}

// A copy of a pool piece at the given size (the pool keeps its originals).
function copyPiece(source, size) {
  const el = document.createElement('canvas');
  el.className = 'scroll-piece';
  el.width = source.width;
  el.height = source.height;
  el.getContext('2d').drawImage(source, 0, 0);
  const scale = size / SCROLL_PIECES.size[1];
  el.style.width = `${parseFloat(source.style.width) * scale}px`;
  el.style.height = `${parseFloat(source.style.height) * scale}px`;
  return el;
}

export async function initScrollPieces(isActive) {
  const gsap = window.gsap;
  if (!gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pool = await sharedPool();
  if (!pool.length) return;

  const layer = document.createElement('div');
  layer.className = 'scroll-pieces';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);

  let lastY = scrollY;
  let travelled = 0;
  let side = 0;
  let onScreen = 0;

  function spawn(direction, speed) {
    if (onScreen >= SCROLL_PIECES.maxOnScreen) return;
    const source = pool[Math.floor(Math.random() * pool.length)];
    const el = copyPiece(source, rand(...SCROLL_PIECES.size));
    const w = parseFloat(el.style.width);
    const h = parseFloat(el.style.height);

    // Inside the left or right margin, alternating.
    const margin = Math.max(SCROLL_PIECES.minMargin, (innerWidth - SCROLL_PIECES.contentWidth) / 2);
    const x = rand(4, Math.max(8, margin - w - 4));
    const left = side++ % 2 === 0 ? x : innerWidth - x - w;
    el.style.left = `${left}px`;
    layer.append(el);
    onScreen++;

    // Falling down (scrolling down) or rising (scrolling up), drifting and turning a little.
    const fromY = direction > 0 ? -h - 20 : innerHeight + 20;
    const toY = direction > 0 ? innerHeight + h + 20 : -h - 40;
    const duration = rand(...SCROLL_PIECES.fall) / Math.min(1.8, 1 + speed / 60);
    gsap.set(el, { y: fromY, rotation: rand(0, 360), autoAlpha: 0 });
    gsap.to(el, { autoAlpha: rand(0.75, 1), duration: 0.3 });
    gsap.to(el, {
      y: toY, x: rand(-24, 24),
      rotation: `+=${rand(120, 300) * (Math.random() < 0.5 ? -1 : 1)}`,
      rotationX: rand(-50, 50), rotationY: rand(-50, 50),
      duration, ease: direction > 0 ? 'power1.in' : 'power1.out',
      onComplete: () => { el.remove(); onScreen--; },
    });
  }

  addEventListener('scroll', () => {
    const delta = scrollY - lastY;
    lastY = scrollY;
    if (!isActive()) return;
    travelled += Math.abs(delta);
    while (travelled >= SCROLL_PIECES.every) {
      travelled -= SCROLL_PIECES.every;
      spawn(Math.sign(delta) || 1, Math.abs(delta));
    }
  }, { passive: true });
}
