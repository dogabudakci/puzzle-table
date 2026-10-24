// Start-page hero: sample photos drawn as finished jigsaw puzzles in picture frames that
// hang on cords from the top of the page, swaying and floating gently (GSAP). Decoration only.

import { puzzleOutline, seededRandom } from './cutter.js';

// The user's own photos; the layouts below pick them by id.
export const SAMPLES = [
  { id: 'ocean-sunset', name: 'Ocean sunset', w: 640, h: 409 },
  { id: 'cinque-terre', name: 'Cinque Terre', w: 426, h: 640 },
  { id: 'snow-cabin', name: 'Snow cabin', w: 640, h: 426 },
  { id: 'meadow', name: 'Meadow', w: 640, h: 426 },
  { id: 'oia', name: 'Oia', w: 640, h: 426 },
  { id: 'orchids', name: 'Orchids', w: 640, h: 426 },
  { id: 'windmill', name: 'Windmill', w: 457, h: 640 },
  { id: 'coastal-rocks', name: 'Coastal rocks', w: 426, h: 640 },
  { id: 'misty-mountains', name: 'Misty mountains', w: 640, h: 427 },
  { id: 'pink-clouds', name: 'Pink clouds', w: 426, h: 640 },
  { id: 'santorini', name: 'Santorini', w: 640, h: 426 },
  { id: 'rain-window', name: 'Rainy window', w: 640, h: 426 },
  { id: 'positano', name: 'Positano', w: 426, h: 640 },
  { id: 'alpine-house', name: 'Alpine house', w: 640, h: 427 },
];

// Every frame hangs on its own cord from the top of the page:
// [place, x, cord length, photo, frame width, frame style, depth (0 far … 1 near)].
// place 'left' / 'right': x is a fraction of the empty margin beside the centred text, measured
// from that side's edge. place 'centre': x is a fraction of the whole width (short cords only,
// so these stay above the text). Short cords keep a frame near the top; long ones let it fall
// down the side.

// Wide screens: frames along the top and down both sides.
const LAYOUT_WIDE = [
  ['left', 0.22, 24, 'ocean-sunset', 176, 'gilt', 0.85],
  ['left', 0.74, 120, 'cinque-terre', 124, 'white', 0.95],
  ['left', 0.3, 300, 'snow-cabin', 170, 'museum', 0.9],
  ['left', 0.78, 430, 'coastal-rocks', 110, 'carved', 0.8],
  ['left', 0.24, 480, 'windmill', 118, 'silver', 0.85],
  ['centre', 0.37, 14, 'santorini', 130, 'white', 0.6],
  ['centre', 0.61, 30, 'oia', 200, 'gilt', 0.7],
  ['right', 0.24, 40, 'orchids', 190, 'carved', 0.9],
  ['right', 0.72, 14, 'positano', 110, 'museum', 0.75],
  ['right', 0.74, 250, 'alpine-house', 170, 'oak', 1],
  ['right', 0.3, 260, 'pink-clouds', 130, 'silver', 0.85],
  ['right', 0.2, 500, 'rain-window', 160, 'museum', 0.7],
];
// Medium screens: a few along the top, the rest falling down the narrow sides.
const LAYOUT_SIDE = [
  ['left', 0.5, 20, 'ocean-sunset', 150, 'gilt', 0.85],
  ['left', 0.42, 220, 'cinque-terre', 100, 'white', 0.95],
  ['left', 0.55, 470, 'snow-cabin', 150, 'museum', 0.9],
  ['centre', 0.4, 10, 'santorini', 110, 'white', 0.6],
  ['centre', 0.6, 24, 'oia', 160, 'gilt', 0.7],
  ['right', 0.5, 30, 'orchids', 150, 'carved', 0.9],
  ['right', 0.45, 240, 'windmill', 100, 'silver', 0.95],
  ['right', 0.55, 490, 'alpine-house', 146, 'oak', 0.85],
];
// Narrow screens: a row along the top, with every other frame on a longer cord, above the text.
const LAYOUT_ROW = [
  ['centre', 0.1, 12, 'ocean-sunset', 80, 'gilt', 0.85],
  ['centre', 0.36, 22, 'santorini', 80, 'white', 0.8],
  ['centre', 0.62, 10, 'orchids', 80, 'carved', 0.85],
  ['centre', 0.88, 26, 'oia', 84, 'museum', 0.8],
  ['centre', 0.21, 104, 'cinque-terre', 62, 'white', 1],
  ['centre', 0.47, 118, 'snow-cabin', 78, 'oak', 0.95],
  ['centre', 0.73, 100, 'alpine-house', 76, 'silver', 0.9],
  ['centre', 0.94, 112, 'windmill', 54, 'museum', 0.9],
];
const TEXT_WIDTH = 640;    // the centred heading's column on wide screens
const CORD_OVERHANG = 60;  // cords start above the stage so a bobbing frame never shows the cord's end

const MISSING_PIECE = new Set(['snow-cabin', 'orchids']);
// Moulding and mat widths as fractions of the frame width: ornate frames are deeper,
// the museum frame is slim with a wide mat.
const FRAME_PROFILES = {
  gilt: [0.05, 0.034], carved: [0.05, 0.034], museum: [0.016, 0.085], silver: [0.032, 0.03],
};
const DEFAULT_PROFILE = [0.022, 0.028];
const rand = (min, max) => min + Math.random() * (max - min);

// Draws the photo as an assembled puzzle; optionally leaves one piece lifted out of its slot.
function drawCard(img, sample, width) {
  const height = Math.round(width * sample.h / sample.w);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const aspect = sample.w / sample.h;
  const count = width < 120 ? 16 : 35; // small frames get bigger pieces so the cuts stay readable
  const cols = Math.max(3, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(3, Math.round(count / cols));
  const rng = seededRandom(sample.id.length * 7919 + cols);
  const outline = puzzleOutline(cols, rows, width, height, rng);

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-puzzle';
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  // Pressed-in seams: a dark groove with a soft highlight beside it.
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, .34)';
  ctx.save();
  ctx.translate(0.5, 0.5);
  ctx.stroke(outline.lines);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, .26)';
  ctx.save();
  ctx.translate(-0.6, -0.6);
  ctx.stroke(outline.lines);
  ctx.restore();

  // A faint sheen, like light on printed card.
  const sheen = ctx.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0, 'rgba(255, 255, 255, .12)');
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, .06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  if (!MISSING_PIECE.has(sample.id)) return { canvas, height };

  // Empty slot where the lifted piece belongs.
  const c = cols - 2;
  const r = 1;
  const slot = outline.piece(c, r);
  ctx.save();
  ctx.clip(slot);
  ctx.fillStyle = '#d8cfc2';
  ctx.fill(slot);
  ctx.shadowColor = 'rgba(40, 30, 20, .55)';
  ctx.shadowBlur = 5;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#a89b88';
  ctx.stroke(slot);
  ctx.restore();

  // The lifted piece itself, on its own canvas so it can float.
  const pieceW = width / cols;
  const pieceH = height / rows;
  const pad = Math.ceil(Math.min(pieceW, pieceH) * 0.35);
  const ox = c * pieceW - pad;
  const oy = r * pieceH - pad;
  const pw = pieceW + pad * 2;
  const ph = pieceH + pad * 2;
  const piece = document.createElement('canvas');
  piece.className = 'hero-piece';
  piece.width = Math.round(pw * dpr);
  piece.height = Math.round(ph * dpr);
  piece.style.width = `${pw}px`;
  piece.style.height = `${ph}px`;
  piece.style.left = `${ox}px`;
  piece.style.top = `${oy}px`;
  const pctx = piece.getContext('2d');
  pctx.scale(dpr, dpr);
  pctx.translate(-ox, -oy);
  pctx.save();
  pctx.clip(slot);
  pctx.drawImage(img, 0, 0, width, height);
  pctx.restore();
  pctx.lineWidth = 1.5;
  pctx.strokeStyle = 'rgba(255, 255, 255, .45)';
  pctx.save();
  pctx.clip(slot);
  pctx.translate(1, 1);
  pctx.stroke(slot);
  pctx.restore();
  pctx.strokeStyle = 'rgba(0, 0, 0, .3)';
  pctx.lineWidth = 1;
  pctx.stroke(slot);
  // How far it hovers from its slot: up and to the side, clearly a separate piece.
  const lift = { x: pieceW * 0.55, y: -pieceH * 0.8 };
  return { canvas, height, piece, lift };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Picture wire: a cord down to a brass ring, then a V to the frame's corners. `overhang` extends
// the cord up past its anchor, so a bobbing frame never shows where the cord ends.
function drawCord(width, length, overhang) {
  const ns = 'http://www.w3.org/2000/svg';
  const height = length + overhang;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'hero-cord');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.top = `${-height}px`;
  const ring = height - Math.min(18, width * 0.12, length * 0.5);
  const cord = document.createElementNS(ns, 'path');
  cord.setAttribute('d', `M ${width / 2} 0 V ${ring} M ${width * 0.2} ${height + 2} L ${width / 2} ${ring} L ${width * 0.8} ${height + 2}`);
  const hook = document.createElementNS(ns, 'circle');
  hook.setAttribute('cx', width / 2);
  hook.setAttribute('cy', ring);
  hook.setAttribute('r', 2.6);
  svg.append(cord, hook);
  return svg;
}

// Background pieces: [left %, top %, size px, start rotation, look]. They sit behind the
// frames and text, so they stay very faint.
const GHOSTS = [
  [4, 70, 90, -18, 'glass'], [14, 88, 54, 24, 'tint'], [30, 62, 70, 8, 'tint'],
  [36, 12, 46, -30, 'glass'], [44, 80, 96, 14, 'glass'], [58, 6, 60, 32, 'tint'],
  [63, 68, 52, -12, 'tint'], [70, 86, 82, -26, 'glass'], [80, 54, 48, 18, 'tint'],
  [92, 80, 100, 6, 'glass'], [50, 40, 120, -8, 'faint'], [22, 36, 64, 40, 'faint'],
  [76, 26, 72, -36, 'faint'],
];
const GHOST_LOOKS = {
  glass: { fill: 'rgba(255, 255, 255, .42)', stroke: 'rgba(255, 255, 255, .9)', shadow: 'rgba(60, 50, 40, .10)' },
  tint: { fill: 'rgba(47, 82, 65, .06)', stroke: 'rgba(47, 82, 65, .18)', shadow: null },
  faint: { fill: 'rgba(47, 82, 65, .025)', stroke: 'rgba(47, 82, 65, .1)', shadow: null },
};

// One loose jigsaw piece (the middle piece of a 3 × 3 cut, so it has four tabs or slots).
function drawGhost(size, look, seed) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const box = size * 1.7;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-ghost';
  canvas.width = Math.round(box * dpr);
  canvas.height = Math.round(box * dpr);
  canvas.style.width = `${box}px`;
  canvas.style.height = `${box}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(box / 2 - size * 1.5, box / 2 - size * 1.5);
  const path = puzzleOutline(3, 3, size * 3, size * 3, seededRandom(seed)).piece(1, 1);
  const style = GHOST_LOOKS[look];
  if (style.shadow) {
    ctx.save();
    ctx.shadowColor = style.shadow;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = style.fill;
    ctx.fill(path);
    ctx.restore();
  } else {
    ctx.fillStyle = style.fill;
    ctx.fill(path);
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = style.stroke;
  ctx.stroke(path);
  return canvas;
}

function initGhosts(layer, gsap, calm, delay) {
  // Small screens get fewer, smaller pieces so the text stays clear.
  const scale = Math.max(0.5, Math.min(1, layer.clientWidth / 1100));
  const narrow = layer.clientWidth < 700;
  GHOSTS.forEach(([left, top, baseSize, rotation, look], i) => {
    if (narrow && i % 2) return;
    const size = Math.round(baseSize * scale);
    const ghost = drawGhost(size, look, 101 + i * 37);
    ghost.style.left = `calc(${left}% - ${size * 0.85}px)`;
    ghost.style.top = `calc(${top}% - ${size * 0.85}px)`;
    layer.append(ghost);
    if (calm) {
      ghost.style.transform = `rotate(${rotation}deg)`;
      return;
    }
    gsap.set(ghost, { rotation });
    gsap.from(ghost, { autoAlpha: 0, duration: 2.4, delay: delay + 0.6 + i * 0.1, ease: 'power2.out' });
    gsap.to(ghost, { y: `+=${rand(-60, 60)}`, x: `+=${rand(-45, 45)}`, duration: rand(7, 11), ease: 'sine.inOut', yoyo: true, repeat: -1 });
    gsap.to(ghost, { rotation: rotation + rand(-14, 14), duration: rand(12, 20), ease: 'sine.inOut', yoyo: true, repeat: -1 });
  });
}

// Stops or restarts every hero animation (the frames are off screen while playing).
export function setHeroRunning(running) {
  const timeline = window.gsap?.globalTimeline;
  if (!timeline) return;
  if (running) timeline.resume();
  else timeline.pause();
}

// Decoration only: framed sample puzzles drop in from the top on their own cords, then sway and float.
// `delay`: seconds to wait before the frames drop in (e.g. while the intro plays).
export async function initHero(container, ghostLayer, { delay = 0 } = {}) {
  const gsap = window.gsap;
  const calm = !gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = container.parentElement;
  if (ghostLayer) initGhosts(ghostLayer, gsap, calm, delay);
  const loaded = await Promise.all(SAMPLES.map((s) => loadImage(`assets/photos/${s.id}-card.jpg`).catch(() => null)));
  const images = new Map(SAMPLES.map((s, i) => [s.id, loaded[i]]));
  let frames = [];

  let startDelay = delay;
  function build() {
    for (const frame of frames) {
      gsap?.killTweensOf([frame.hang, frame.bob, frame.piece].filter(Boolean));
      frame.hang.remove();
    }
    frames = [];

    const stageW = container.clientWidth;
    const gutter = (stageW - TEXT_WIDTH) / 2;
    const mode = gutter >= 250 ? 'wide' : gutter >= 130 ? 'side' : 'row';
    const narrow = mode === 'row';
    const layout = { wide: LAYOUT_WIDE, side: LAYOUT_SIDE, row: LAYOUT_ROW }[mode];
    const scale = { wide: Math.min(1.1, gutter / 400), side: Math.min(1.2, gutter / 180), row: Math.min(1.5, stageW / 390) }[mode];
    // The stage's height depends on the layout (see .hero-stage[data-layout] in the CSS).
    stage.dataset.layout = mode;
    const cordScale = narrow ? scale : Math.min(1, stage.clientHeight / 720);
    let lowest = 0;

    layout.forEach(([place, x, cordLength, id, baseWidth, style, depth], i) => {
      const sample = SAMPLES.find((s) => s.id === id);
      const img = images.get(id);
      if (!sample || !img) return;
      const width = Math.round(baseWidth * scale);
      const [mouldingShare, matShare] = FRAME_PROFILES[style] ?? DEFAULT_PROFILE;
      const moulding = Math.max(3, Math.round(width * mouldingShare));
      const mat = Math.round(width * matShare) + 2;
      const { canvas, height, piece, lift } = drawCard(img, sample, width - 2 * (moulding + mat));
      const length = Math.round(cordLength * cordScale);

      // hang: placed and dropped in; bob: floats on the cord; frameEl: the frame itself.
      const hang = document.createElement('div');
      hang.className = 'hero-hang';
      hang.style.setProperty('--depth', depth);
      // Longer cords hang further back, so they pass behind the frames above them.
      hang.style.zIndex = String(100 - Math.round(cordLength / 10));
      const centre = place === 'centre' ? x * stageW : place === 'left' ? x * gutter : stageW - x * gutter;
      hang.style.left = `${Math.round(Math.max(4, Math.min(stageW - width - 4, centre - width / 2)))}px`;
      hang.style.top = `${length}px`;
      const bob = document.createElement('div');
      bob.className = 'hero-bob';
      const frameEl = document.createElement('div');
      frameEl.className = `hero-frame frame-${style}`;
      frameEl.style.padding = `${moulding}px`;
      const matEl = document.createElement('div');
      matEl.className = 'hero-mat';
      matEl.style.padding = `${mat}px`;
      const art = document.createElement('div');
      art.className = 'hero-art';
      art.append(canvas);
      if (piece) art.append(piece);
      matEl.append(art);
      frameEl.append(matEl);
      bob.append(drawCord(width, length, CORD_OVERHANG), frameEl);
      hang.append(bob);
      container.append(hang);
      lowest = Math.max(lowest, length + height + 2 * (moulding + mat));

      const frame = { hang, bob, piece, depth };
      frames.push(frame);
      const restTilt = rand(-1.2, 1.2);
      if (calm) {
        hang.style.transform = `rotate(${restTilt}deg)`;
        if (piece) piece.style.transform = `translate(${lift.x}px, ${lift.y}px) rotate(14deg)`;
        return;
      }

      // Drop in from above the page, swing to rest, then keep swaying and floating on the cord.
      gsap.set(hang, { transformOrigin: `50% ${-length}px` });
      const sway = rand(0.9, 1.8) * (1.2 - depth * 0.4);
      gsap.timeline({ delay: startDelay + 0.2 + i * 0.12 })
        .from(hang, { y: -(length + height + 200), duration: 1.5, ease: 'back.out(1.1)' })
        .fromTo(hang, { rotation: rand(4, 8) * (i % 2 ? 1 : -1) },
          { rotation: restTilt + sway, duration: 2.2, ease: 'elastic.out(1, 0.4)' }, '<0.5')
        .to(hang, { rotation: restTilt - sway, duration: rand(3.6, 5.6), ease: 'sine.inOut', yoyo: true, repeat: -1 });
      gsap.to(bob, { y: rand(5, 9) + depth * 4, duration: rand(3.2, 4.8), ease: 'sine.inOut', yoyo: true, repeat: -1, delay: rand(1.5, 3) });
      frame.moveX = gsap.quickTo(hang, 'x', { duration: 1.4, ease: 'power2.out' });
      if (piece) {
        gsap.set(piece, { x: lift.x, y: lift.y, rotation: 14 });
        gsap.to(piece, { y: lift.y - 5, rotation: 8, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      }
    });

    // On narrow screens the text sits below the row of frames.
    stage.style.setProperty('--hang-space', narrow ? `${lowest + 28}px` : '');
  }

  build();
  startDelay = 0;

  // Gentle parallax: nearer frames follow the pointer a little more than distant ones.
  if (!calm) {
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      for (const frame of frames) frame.moveX?.(px * 22 * frame.depth);
    });
  }

  let resizeTimer = null;
  let lastWidth = container.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(container.clientWidth - lastWidth) < 40) return;
      lastWidth = container.clientWidth;
      build();
    }, 200);
  });
}
