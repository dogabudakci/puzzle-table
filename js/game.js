// The play screen: a table with the puzzle pieces on it.
//
// Pieces live in groups. A group is a <div> whose position is where the puzzle's top-left
// corner would be; each piece sits inside it at its own place in the finished picture. So
// two groups fit together exactly when their positions are equal, and merging them just
// means moving the pieces of one into the other.
//
// The table can be zoomed and panned (pinch, wheel, or dragging the empty table). Everything on
// it lives in `world`, an element as big as the table that the view scales and moves; positions
// are always in world coordinates, so zooming never changes where anything is. A shared table
// has a fixed world size instead, the same on every screen, shown scaled to fit.
//
// Playing together with a friend, the same table is shown on both screens. Positions are then
// exchanged in a screen-independent form (see normalized()), the `shared` callbacks report what
// this player does, and the remote*() methods show what the friend does.

import { cutPuzzle, shuffle, seededRandom, redrawPieces, maxResolution } from './cutter.js';
import { puzzleSizeOnScreen } from './pieceOptions.js';
import { getTable, tableTextureUrl } from './textures.js';
import { createPouch } from './pouch.js';
import { playSnap, playDrop, playComplete, playPouchOpen, confetti } from './effects.js';

const SPILL_TIME = 1100; // ms until the last piece starts flying out
const SNAP_RATIO = 0.25;  // how close (relative to piece size) counts as "fits"
const LIFT_SCALE = 1.045; // a picked-up piece grows this much
const MAX_TILT = 7;       // degrees a single piece leans towards the drag direction
const UNDO_LIMIT = 30;
export const MAX_ZOOM = 4;
const EDGE_PAN = 48;      // px from the screen edge where dragging a piece scrolls a zoomed table

export class PuzzleGame {
  // seed: makes the cut repeatable, so a saved puzzle comes back with the same shapes.
  // restore: a saved layout from serialize(); the pieces start on the table, without the pouch.
  // autoPouch: the pouch can't be clicked; it opens with openPouch() (live games start together).
  // shared: { onGrab(group), onMove(group), onDrop(group) } while playing on a friend's table.
  // onZoom(zoom): the view's zoom changed (1 = the whole table).
  // worldSize: { width, height } for a table of fixed size (a shared one); otherwise it's the screen's.
  constructor(tableEl, photo, { cols, rows }, tableId, {
    onSpill, onProgress, onComplete, onChange, onZoom, seed, restore, autoPouch = false, shared = null, worldSize = null,
  } = {}) {
    this.table = tableEl;
    this.world = document.createElement('div');
    this.world.className = 'world';
    this.fixedWorld = worldSize;
    if (worldSize) {
      this.world.classList.add('fixed');
      this.world.style.width = `${worldSize.width}px`;
      this.world.style.height = `${worldSize.height}px`;
    }
    this.table.append(this.world);
    this.view = { x: 0, y: 0, zoom: 1 };
    this.onZoom = onZoom;
    this.pointers = new Map(); // touches/pointers on the table that aren't moving a piece (pan, pinch)
    this.pan = null;
    this.onChange = onChange; // called after anything worth saving changes
    this.onSpill = onSpill;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.ready = false; // pieces can't be moved until they've landed
    this.paused = false;
    this.drag = null;
    this.hintsUsed = 0;
    this.hintShown = null;
    this.topZ = 1;
    this.moves = 0;      // pick-ups that moved a piece
    this.history = [];   // earlier positions, for undo
    this.motion = null;  // the springy lift/tilt of the group in hand (or just dropped)
    this.shared = shared;
    this.remoteHeld = new Set(); // pieces in the friend's hand
    this.spillLayout = null;     // where the pieces land when the pouch opens (a shared table)
    this.setTable(tableId);

    const size = puzzleSizeOnScreen(photo.canvas.width / photo.canvas.height, this.worldWidth, this.worldHeight);
    this.puzzle = cutPuzzle(photo.canvas, cols, rows, size.width, size.height, seededRandom(seed ?? Date.now()));
    const { pieces, pieceW, pieceH } = this.puzzle;
    this.snapDistance = Math.max(8, Math.min(pieceW, pieceH) * SNAP_RATIO);

    // A faint mat in the middle marks the empty work area where the puzzle fits.
    this.mat = document.createElement('div');
    this.mat.className = 'work-mat';
    this.world.append(this.mat);
    this.placeMat();

    for (const piece of pieces) {
      if (isInterior(piece, this.puzzle)) piece.canvas.classList.add('interior');
      piece.canvas.style.left = `${piece.ox}px`;
      piece.canvas.style.top = `${piece.oy}px`;
    }
    this.groups = new Set();
    if (restore) {
      this.restoreLayout(restore);
    } else {
      // Every piece starts as its own group, hidden in the pouch.
      // Appended in random order so the stacking is mixed too.
      this.table.classList.add('in-pouch');
      for (const piece of shuffle(pieces)) this.addGroup([piece]);
      this.pouch = createPouch(pieces.length, (mouth) => this.spill(mouth));
      if (autoPouch) {
        this.pouch.disabled = true;
        this.pouch.querySelector('.pouch-hint').textContent = 'Get ready…';
      }
      this.table.append(this.pouch);
    }

    this.handlers = {
      pointerdown: (e) => this.pointerDown(e),
      pointermove: (e) => this.pointerMove(e),
      pointerup: (e) => this.pointerUp(e),
      pointercancel: (e) => this.pointerUp(e),
      wheel: (e) => this.wheel(e),
      // Safari on a Mac reports trackpad pinches as gestures rather than ctrl + wheel.
      gesturestart: (e) => this.gesture(e),
      gesturechange: (e) => this.gesture(e),
    };
    for (const [type, fn] of Object.entries(this.handlers)) {
      this.table.addEventListener(type, fn, type === 'wheel' ? { passive: false } : undefined);
    }
    this.onResize = () => {
      this.placeMat();
      for (const group of this.groups) this.placeGroup(group, group.x, group.y);
      this.setView(this.view.x, this.view.y, Math.max(this.view.zoom, this.fitZoom()));
    };
    window.addEventListener('resize', this.onResize);
    this.setView(0, 0, this.fitZoom());
  }

  get worldWidth() {
    return this.fixedWorld?.width ?? this.table.clientWidth;
  }

  get worldHeight() {
    return this.fixedWorld?.height ?? this.table.clientHeight;
  }

  addGroup(pieces) {
    const el = document.createElement('div');
    el.className = 'group';
    pieces.sort((a, b) => a.index - b.index);
    el.append(...pieces.map((p) => p.canvas));
    const group = { el, x: 0, y: 0, scale: 1, tilt: 0, pieces, bounds: groupBounds(pieces, this.puzzle) };
    for (const piece of pieces) piece.group = group;
    this.groups.add(group);
    this.world.append(el);
    return group;
  }

  /* ---------- Saving ---------- */

  // The layout in a screen-independent form: each group's pieces, its position relative to the
  // work area in puzzle sizes, and its stacking order.
  serialize() {
    const { x: wx, y: wy } = this.workArea();
    const { width, height } = this.puzzle;
    return [...this.groups].map((g) => ({
      pieces: g.pieces.map((p) => p.index),
      nx: (g.x - wx) / width,
      ny: (g.y - wy) / height,
      z: Number(g.el.style.zIndex) || 0,
    }));
  }

  restoreLayout(saved) {
    const { pieces, width, height } = this.puzzle;
    const { x: wx, y: wy } = this.workArea();
    const placed = new Set();
    for (const entry of [...saved].sort((a, b) => a.z - b.z)) {
      const members = entry.pieces.map((i) => pieces[i]).filter((p) => p && !placed.has(p));
      if (!members.length) continue;
      members.forEach((p) => placed.add(p));
      const group = this.addGroup(members);
      group.el.style.zIndex = entry.z;
      this.topZ = Math.max(this.topZ, entry.z);
      this.placeGroup(group, wx + entry.nx * width, wy + entry.ny * height);
    }
    // Anything the save didn't mention (shouldn't happen) goes back on the table loose.
    const missing = pieces.filter((p) => !placed.has(p));
    if (missing.length) {
      const spots = this.scatterPositions();
      for (const piece of missing) {
        const group = this.addGroup([piece]);
        this.placeGroup(group, spots[piece.index].x - piece.ox, spots[piece.index].y - piece.oy);
      }
    }
    this.ready = true;
  }

  // A group's position relative to the puzzle's place, in puzzle sizes: the same on every screen.
  normalized(group) {
    const { x: wx, y: wy, width, height } = this.workArea();
    return { nx: (group.x - wx) / width, ny: (group.y - wy) / height };
  }

  fromNormalized(nx, ny) {
    const { x: wx, y: wy, width, height } = this.workArea();
    return { x: wx + nx * width, y: wy + ny * height };
  }

  // Where the pieces would land on this screen, for a shared table's starting layout.
  startLayout() {
    const spots = this.scatterPositions();
    return this.puzzle.pieces.map((piece) => {
      const { nx, ny } = this.normalized({ x: spots[piece.index].x - piece.ox, y: spots[piece.index].y - piece.oy });
      return { pieces: [piece.index], nx, ny };
    });
  }

  /* ---------- Pouch ---------- */

  openPouch() {
    if (!this.pouch?.isConnected) return;
    this.pouch.disabled = false;
    this.pouch.click();
  }

  // Throws every piece out of the pouch's mouth (viewport coords) onto its scattered spot.
  spill(mouth) {
    const from = this.toWorld(mouth.x, mouth.y);
    const targets = this.spillLayout ? this.layoutTargets(this.spillLayout) : this.scatterPositions();
    const groups = shuffle([...this.groups]);
    const stagger = Math.min(30, SPILL_TIME / groups.length);
    const { pieceW, pieceH, pad } = this.puzzle;
    const halfW = pieceW / 2 + pad;
    const halfH = pieceH / 2 + pad;

    this.table.classList.remove('in-pouch');
    playPouchOpen(groups.length, (SPILL_TIME + 1000) / 1000);
    const flights = groups.map((group, i) => {
      const piece = group.pieces[0];
      const { x, y } = targets[piece.index]; // where the piece's canvas lands
      group.x = x - piece.ox;
      group.y = y - piece.oy;
      this.applyPosition(group);

      // Spin and scale around the piece's centre; canvas positions are converted to group positions.
      group.el.style.transformOrigin = `${piece.ox + halfW}px ${piece.oy + halfH}px`;
      const at = (cx, cy, scale, rotate) =>
        `translate(${cx - piece.ox}px, ${cy - piece.oy}px) scale(${scale}) rotate(${rotate}deg)`;
      const spin = (Math.random() - 0.5) * 720;
      // Pops up out of the pouch first, then arcs down to its spot.
      const midX = from.x + (x + halfW - from.x) * 0.35 - halfW;
      const midY = from.y + (y + halfH - from.y) * 0.35 - halfH - 70 - Math.random() * 50;

      return group.el.animate([
        { transform: at(from.x - halfW, from.y - halfH, 0.2, spin), opacity: 0 },
        { transform: at(midX, midY, 0.8, spin * 0.4), opacity: 1, offset: 0.35 },
        { transform: at(x, y, 1, 0), opacity: 1 },
      ], {
        duration: 750 + Math.random() * 300,
        delay: 150 + i * stagger,
        easing: 'cubic-bezier(.2, .6, .35, 1)',
        fill: 'backwards',
      }).finished;
    });

    Promise.all(flights).then(() => { this.ready = true; this.onChange?.(); }, () => {});
    this.onSpill?.();
  }

  // Landing spots (canvas positions) for single pieces from a normalized layout.
  layoutTargets(layout) {
    const { pieces } = this.puzzle;
    const targets = this.scatterPositions(); // for any piece the layout doesn't mention
    for (const entry of layout) {
      const piece = pieces[entry.pieces[0]];
      if (!piece) continue;
      const { x, y } = this.fromNormalized(entry.nx, entry.ny);
      targets[piece.index] = { x: x + piece.ox, y: y + piece.oy };
    }
    return targets;
  }

  // The middle of the table, where the finished puzzle goes (table coords).
  workArea() {
    const { width, height } = this.puzzle;
    const x = (this.worldWidth - width) / 2;
    const y = (this.worldHeight - height) / 2;
    return { x, y, width, height };
  }

  placeMat() {
    const { x, y, width, height } = this.workArea();
    const border = this.puzzle.pad;
    Object.assign(this.mat.style, {
      left: `${x - border}px`,
      top: `${y - border}px`,
      width: `${width + border * 2}px`,
      height: `${height + border * 2}px`,
    });
  }

  // Random spots around the edges of the table, leaving the work area in the middle empty.
  // A jittered grid keeps the pieces from piling up; if the edges are too small for every
  // piece, the grid gets finer (so pieces overlap a little) before giving up on the gap.
  scatterPositions() {
    const { pieces, pieceW, pieceH, pad } = this.puzzle;
    const view = { width: this.worldWidth, height: this.worldHeight };
    const margin = 12;
    const areaW = view.width - margin * 2;
    const areaH = view.height - margin * 2;
    const work = this.workArea();

    let cells = null;
    let cellW = 0;
    let cellH = 0;
    let fallback = null; // the first, coarsest grid over the whole table
    for (let cellsX = Math.ceil(Math.sqrt(pieces.length * areaW / areaH)); cellsX <= 120; cellsX++) {
      const cellsY = Math.max(1, Math.ceil(cellsX * areaH / areaW));
      cellW = areaW / cellsX;
      cellH = areaH / cellsY;
      const all = [];
      for (let row = 0; row < cellsY; row++) {
        for (let col = 0; col < cellsX; col++) {
          all.push({ cx: margin + (col + 0.5) * cellW, cy: margin + (row + 0.5) * cellH });
        }
      }
      // A cell is free if a piece centred in it (plus jitter) stays clear of the work area.
      const keepX = pieceW * 0.6 + cellW * 0.2;
      const keepY = pieceH * 0.6 + cellH * 0.2;
      const free = all.filter(({ cx, cy }) =>
        cx < work.x - keepX || cx > work.x + work.width + keepX ||
        cy < work.y - keepY || cy > work.y + work.height + keepY);
      if (free.length >= pieces.length) {
        cells = free;
        break;
      }
      fallback ??= { all, cellW, cellH };
    }
    if (!cells) {
      // Very small screen: there's no room around the work area, so use the whole table.
      ({ all: cells, cellW, cellH } = fallback);
    }
    cells = shuffle(cells);

    return pieces.map((piece, i) => {
      const { cx, cy } = cells[i % cells.length];
      const x = cx + (Math.random() - 0.5) * cellW * 0.4;
      const y = cy + (Math.random() - 0.5) * cellH * 0.4;
      return {
        x: clamp(x - pieceW / 2 - pad, margin - pad, view.width - margin - pieceW - pad),
        y: clamp(y - pieceH / 2 - pad, margin - pad, view.height - margin - pieceH - pad),
      };
    });
  }

  /* ---------- Dragging ---------- */

  // The piece whose actual shape (not just its rectangular canvas) is under the pointer.
  pieceAt(clientX, clientY) {
    const { pieces } = this.puzzle;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!el.classList.contains('piece')) continue;
      const piece = pieces[el.dataset.index];
      const rect = el.getBoundingClientRect();
      // Screen pixels to canvas pixels, whatever the zoom or lift.
      const scale = piece.canvas.width / rect.width;
      if (piece.ctx.isPointInPath(piece.path, (clientX - rect.left) * scale, (clientY - rect.top) * scale)) {
        return piece;
      }
    }
    return null;
  }

  pointerDown(e) {
    if (e.button > 0 || e.target.closest('.pouch')) return;
    const piece = this.ready && !this.paused && !this.drag && this.pointers.size === 0
      ? this.pieceAt(e.clientX, e.clientY) : null;
    if (!piece) {
      if (!this.drag) this.startPan(e); // the empty table (or a second finger): move the view
      return;
    }
    e.preventDefault();
    if (this.isRemoteHeld(piece.group)) {
      // The friend has it in hand: a small shake says "not now".
      piece.group.el.animate([{ translate: '0' }, { translate: '-4px' }, { translate: '4px' }, { translate: '0' }], { duration: 220 });
      return;
    }
    this.clearHint(); // the line would point at the old spot once a piece moves

    const { group } = piece;
    group.el.style.zIndex = ++this.topZ;
    group.el.classList.add('lifted');
    // Lean and grow around the point that was grabbed.
    const at = this.toWorld(e.clientX, e.clientY);
    group.el.style.transformOrigin = `${at.x - group.x}px ${at.y - group.y}px`;
    this.drag = {
      group, pointerId: e.pointerId, dx: at.x - group.x, dy: at.y - group.y,
      startX: group.x, startY: group.y, lastX: e.clientX, speed: 0, clientX: e.clientX, clientY: e.clientY,
    };
    this.animateLift(group, LIFT_SCALE);
    playDrop(); // Reuse the existing cardboard tap when a piece is picked up.
    this.shared?.onGrab(group);
    try {
      this.table.setPointerCapture(e.pointerId); // keep receiving moves even off the table
    } catch {
      // The pointer is already gone; pointerup/cancel will end the drag.
    }
  }

  pointerMove(e) {
    if (this.pointers.has(e.pointerId)) return this.movePan(e);
    if (this.drag?.pointerId !== e.pointerId) return;
    const { drag } = this;
    drag.speed = drag.speed * 0.6 + (e.clientX - drag.lastX) * 0.4; // smoothed sideways speed
    drag.lastX = e.clientX;
    drag.clientX = e.clientX;
    drag.clientY = e.clientY;
    this.moveDragged();
    this.edgePan();
  }

  moveDragged() {
    const { drag } = this;
    const at = this.toWorld(drag.clientX, drag.clientY);
    this.placeGroup(drag.group, at.x - drag.dx, at.y - drag.dy);
    this.shared?.onMove(drag.group);
  }

  pointerUp(e) {
    if (this.pointers.has(e.pointerId)) return this.endPan(e);
    if (this.drag?.pointerId !== e.pointerId) return;
    cancelAnimationFrame(this.edgeFrame);
    this.edgeFrame = null;
    const { group, startX, startY } = this.drag;
    this.drag = null;
    group.el.classList.remove('lifted');
    const moved = Math.hypot(group.x - startX, group.y - startY) > 3;
    if (moved) {
      this.moves++;
      if (!this.shared) this.history.push({ group, x: startX, y: startY }); // no undo on a shared table
      if (this.history.length > UNDO_LIMIT) this.history.shift();
    }
    // Settle back down with a little bounce.
    this.animateLift(group, 1);
    const { pieces } = group;
    if (!this.trySnap(group) && moved) playDrop();
    if (this.shared) {
      // The group in hand, with any it just joined, and where it ended up.
      const result = pieces[0].group;
      this.shared.onDrop({ pieces: result.pieces.map((p) => p.index), ...this.normalized(result) });
    }
    if (moved && this.groups.size > 1) this.onChange?.();
  }

  // Lets go of the piece in hand without moving it (the friend got to it first).
  cancelDrag() {
    if (!this.drag) return;
    const { group, startX, startY } = this.drag;
    this.drag = null;
    group.el.classList.remove('lifted');
    this.placeGroup(group, startX, startY);
    this.animateLift(group, 1);
  }

  /* ---------- Zoom and pan ---------- */

  // Screen (client) coordinates to world coordinates.
  toWorld(clientX, clientY) {
    const rect = this.table.getBoundingClientRect();
    const { x, y, zoom } = this.view;
    return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
  }

  // The zoom at which the whole table just fits on screen (1, unless the table has a fixed size).
  fitZoom() {
    if (!this.fixedWorld) return 1;
    return Math.min(this.table.clientWidth / this.worldWidth, this.table.clientHeight / this.worldHeight);
  }

  // Moves and scales the view. The table always fills the screen, or is centred if it's smaller.
  setView(x, y, zoom, { animate = false } = {}) {
    const fit = this.fitZoom();
    zoom = clamp(zoom, fit, fit * MAX_ZOOM);
    const place = (pos, screen, size) => (size <= screen ? (screen - size) / 2 : clamp(pos, screen - size, 0));
    x = place(x, this.table.clientWidth, this.worldWidth * zoom);
    y = place(y, this.table.clientHeight, this.worldHeight * zoom);
    const changed = zoom !== this.view.zoom;
    if (changed) this.sharpen(zoom);
    if (animate) {
      this.world.animate([{ transform: this.world.style.transform || 'none' }, { transform: viewTransform(x, y, zoom) }],
        { duration: 350, easing: 'cubic-bezier(.3, .7, .2, 1)' });
    }
    this.view = { x, y, zoom };
    this.world.style.transform = viewTransform(x, y, zoom);
    this.table.classList.toggle('zoomed', zoom > fit * 1.001);
    if (changed) this.onZoom?.(zoom / fit);
  }

  // Zooms by `factor` around a screen point (the middle of the table if none is given).
  zoomBy(factor, clientX, clientY, options) {
    const rect = this.table.getBoundingClientRect();
    const cx = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const cy = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const { x, y, zoom } = this.view;
    const fit = this.fitZoom();
    const next = clamp(zoom * factor, fit, fit * MAX_ZOOM);
    // Keep the world point under (cx, cy) where it is.
    this.setView(cx - (cx - x) * (next / zoom), cy - (cy - y) * (next / zoom), next, options);
  }

  // Once the zoom settles, redraws the pieces as sharp as the new size needs.
  sharpen(zoom) {
    clearTimeout(this.sharpenTimer);
    this.sharpenTimer = setTimeout(async () => {
      const dpr = window.devicePixelRatio || 1;
      const wanted = Math.max(dpr, Math.min(maxResolution(this.puzzle), dpr * Math.ceil(zoom * 2) / 2));
      if (Math.abs(wanted - this.puzzle.dpr) < 0.25) return;
      const run = (this.sharpenRun ?? 0) + 1;
      this.sharpenRun = run;
      await redrawPieces(this.puzzle, wanted, () => this.sharpenRun !== run || this.destroyed);
    }, 300);
  }

  resetView(options = { animate: true }) {
    this.setView(0, 0, this.fitZoom(), options);
  }

  // Pinching on a trackpad (or ctrl + wheel) and mouse wheels zoom; two-finger scrolling pans.
  wheel(e) {
    if (this.table.classList.contains('in-pouch')) return;
    e.preventDefault();
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouseWheel) {
      const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomBy(Math.exp(-clamp(step, -100, 100) * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
    } else {
      this.setView(this.view.x - e.deltaX, this.view.y - e.deltaY, this.view.zoom);
    }
    if (this.drag) this.moveDragged();
  }

  gesture(e) {
    e.preventDefault(); // otherwise Safari zooms the whole page
    if (this.pointers.size || this.table.classList.contains('in-pouch')) return; // touch pinches are handled as pointers
    if (e.type === 'gesturestart') {
      this.gestureZoom = this.view.zoom;
      return;
    }
    this.zoomBy((this.gestureZoom * e.scale) / this.view.zoom, e.clientX, e.clientY);
  }

  startPan(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pan = this.panStart();
    this.table.classList.add('panning');
    try {
      this.table.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone.
    }
  }

  // Where the fingers are now and how far apart, so moving and pinching are relative to this.
  panStart() {
    const points = [...this.pointers.values()];
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const spread = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    return { cx, cy, spread, view: { ...this.view } };
  }

  movePan(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = this.panStart();
    const { pan } = this;
    if (now.spread && pan.spread) {
      // Two fingers: zoom around the point between them, and follow them as they move.
      const fit = this.fitZoom();
      const zoom = clamp(pan.view.zoom * (now.spread / pan.spread), fit, fit * MAX_ZOOM);
      const rect = this.table.getBoundingClientRect();
      const sx = pan.cx - rect.left;
      const sy = pan.cy - rect.top;
      const k = zoom / pan.view.zoom;
      this.setView(sx - (sx - pan.view.x) * k + (now.cx - pan.cx), sy - (sy - pan.view.y) * k + (now.cy - pan.cy), zoom);
    } else {
      this.setView(pan.view.x + now.cx - pan.cx, pan.view.y + now.cy - pan.cy, pan.view.zoom);
    }
  }

  endPan(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size) {
      this.pan = this.panStart(); // one finger lifted: carry on panning with the other
    } else {
      this.pan = null;
      this.table.classList.remove('panning');
    }
  }

  // Dragging a piece near the edge of a zoomed table scrolls it, so pieces can go anywhere.
  edgePan() {
    if (this.view.zoom <= this.fitZoom() * 1.001 || this.edgeFrame) return;
    const step = () => {
      this.edgeFrame = null;
      const { drag } = this;
      if (!drag) return;
      const rect = this.table.getBoundingClientRect();
      const push = (pos, low, high) => (pos < low + EDGE_PAN ? (low + EDGE_PAN - pos) / EDGE_PAN
        : pos > high - EDGE_PAN ? -(pos - high + EDGE_PAN) / EDGE_PAN : 0);
      const dx = push(drag.clientX, rect.left, rect.right) * 14;
      const dy = push(drag.clientY, rect.top, rect.bottom) * 14;
      if (!dx && !dy) return;
      const before = { ...this.view };
      this.setView(before.x + dx, before.y + dy, before.zoom);
      if (this.view.x === before.x && this.view.y === before.y) return; // reached the table's edge
      this.moveDragged();
      this.edgeFrame = requestAnimationFrame(step);
    };
    this.edgeFrame = requestAnimationFrame(step);
  }

  // Springs the group's size (and lean, while dragging) towards `targetScale`, frame by frame.
  // Overshooting on the way down gives the landing its small bounce.
  animateLift(group, targetScale) {
    if (this.motion && this.motion.group !== group) this.settleNow(this.motion.group);
    const motion = this.motion?.group === group ? this.motion : { group, velocity: 0 };
    motion.target = targetScale;
    this.motion = motion;
    if (motion.frame) return;
    const step = () => {
      const lean = MAX_TILT / Math.sqrt(group.pieces.length);
      const speed = this.drag?.group === group ? this.drag.speed : 0;
      if (this.drag) this.drag.speed *= 0.85; // fades when the pointer stops moving
      group.tilt += (clamp(speed * 0.5, -lean, lean) - group.tilt) * 0.2;
      motion.velocity = (motion.velocity + (motion.target - group.scale) * 0.2) * 0.7;
      group.scale += motion.velocity;
      this.applyPosition(group);
      const resting = !this.drag && Math.abs(motion.velocity) < 0.0005 &&
        Math.abs(group.scale - motion.target) < 0.0005 && Math.abs(group.tilt) < 0.05;
      if (resting) return this.settleNow(group);
      motion.frame = requestAnimationFrame(step);
    };
    motion.frame = requestAnimationFrame(step);
  }

  settleNow(group) {
    if (this.motion?.group === group) {
      cancelAnimationFrame(this.motion.frame);
      this.motion = null;
    }
    group.scale = 1;
    group.tilt = 0;
    this.applyPosition(group);
  }

  // While paused (or after time runs out) pieces can't be picked up; a piece in hand is dropped.
  setPaused(paused) {
    this.paused = paused;
    if (paused) this.clearHint();
    if (paused && this.drag) {
      this.pointerUp({ pointerId: this.drag.pointerId });
    }
  }

  // Moves a group, keeping all of it on the table.
  placeGroup(group, x, y) {
    const { left, top, right, bottom } = group.bounds;
    group.x = clamp(x, -left, this.worldWidth - right);
    group.y = clamp(y, -top, this.worldHeight - bottom);
    this.applyPosition(group);
  }

  applyPosition(group) {
    const lifted = group.scale !== 1 || group.tilt !== 0;
    group.el.style.transform = `translate(${group.x}px, ${group.y}px)` +
      (lifted ? ` rotate(${group.tilt}deg) scale(${group.scale})` : '');
  }

  /* ---------- Snapping ---------- */

  neighbors(piece) {
    const { pieces, cols, rows } = this.puzzle;
    const result = [];
    if (piece.col > 0) result.push(pieces[piece.index - 1]);
    if (piece.col < cols - 1) result.push(pieces[piece.index + 1]);
    if (piece.row > 0) result.push(pieces[piece.index - cols]);
    if (piece.row < rows - 1) result.push(pieces[piece.index + cols]);
    return result;
  }

  // Joins the dropped group with every neighbouring group that's close enough to its right place.
  trySnap(group) {
    const dropped = [...group.pieces]; // the pieces that were just moved, for the snap effect
    let snapped = false;
    search: for (;;) {
      for (const piece of group.pieces) {
        for (const neighbor of this.neighbors(piece)) {
          const other = neighbor.group;
          if (other === group || this.isRemoteHeld(other)) continue;
          if (Math.abs(other.x - group.x) < this.snapDistance && Math.abs(other.y - group.y) < this.snapDistance) {
            group = this.merge(group, other);
            snapped = true;
            continue search;
          }
        }
      }
      break;
    }
    if (!snapped) return false;

    playSnap();
    this.snapEffect(group, dropped);
    this.onProgress?.(this.progress(), this.connectedPieces(), this.puzzle.pieces.length);
    if (this.groups.size === 1) this.complete();
    return true;
  }

  // A warm glow along the joined pieces' outlines, a tiny settle and a few sparks at the join.
  snapEffect(group, dropped) {
    for (const piece of dropped) {
      piece.canvas.classList.remove('snap-flash');
      void piece.canvas.offsetWidth; // restart the animation if it's still running
      piece.canvas.classList.add('snap-flash');
      piece.canvas.addEventListener('animationend', () => piece.canvas.classList.remove('snap-flash'), { once: true });
    }
    group.scale = 1.025;
    this.animateLift(group, 1);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const { pieceW, pieceH, pad } = this.puzzle;
    const xs = dropped.map((p) => p.ox + pad + pieceW / 2);
    const ys = dropped.map((p) => p.oy + pad + pieceH / 2);
    const cx = group.x + (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = group.y + (Math.min(...ys) + Math.max(...ys)) / 2;
    const burst = document.createElement('div');
    burst.className = 'snap-sparks';
    burst.style.left = `${cx}px`;
    burst.style.top = `${cy}px`;
    this.world.append(burst);
    const flights = [];
    for (let i = 0; i < 10; i++) {
      const dot = document.createElement('span');
      burst.append(dot);
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
      const distance = Math.min(pieceW, pieceH) * (0.45 + Math.random() * 0.35);
      flights.push(dot.animate([
        { transform: 'translate(-50%, -50%) scale(.3)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(1)`, opacity: 0 },
      ], { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.2, .7, .3, 1)' }).finished);
    }
    Promise.all(flights).finally(() => burst.remove());
  }

  // Merges `moving` into `still`; the result sits exactly where `still` was.
  merge(moving, still) {
    // Keep the bigger group's element so fewer pieces need to move in the DOM.
    const [keep, drop] = moving.pieces.length >= still.pieces.length ? [moving, still] : [still, moving];
    keep.x = still.x;
    keep.y = still.y;
    for (const piece of drop.pieces) piece.group = keep;
    keep.pieces.push(...drop.pieces);
    // Pieces drawn in row order, so each piece's shadow falls under its lower/right neighbours.
    keep.pieces.sort((a, b) => a.index - b.index);
    keep.el.replaceChildren(...keep.pieces.map((p) => p.canvas));
    keep.el.style.zIndex = Math.max(Number(moving.el.style.zIndex) || 0, Number(still.el.style.zIndex) || 0);
    keep.bounds = groupBounds(keep.pieces, this.puzzle);
    this.applyPosition(keep);

    drop.el.remove();
    this.groups.delete(drop);
    // Undo can't pull joined pieces apart, so forget earlier positions of either group.
    this.history = this.history.filter((h) => h.group !== keep && h.group !== drop);
    return keep;
  }

  /* ---------- A friend's hands on the shared table ---------- */

  isRemoteHeld(group) {
    return group.pieces.some((p) => this.remoteHeld.has(p.index));
  }

  // If the friend takes or moves the group in this player's hand, this player lets go.
  yieldTo(pieces) {
    if (this.drag && this.drag.group.pieces.some((p) => pieces.includes(p.index))) this.cancelDrag();
  }

  remoteGrab(pieces) {
    this.remoteRelease();
    this.yieldTo(pieces);
    const group = this.puzzle.pieces[pieces[0]]?.group;
    if (!group) return;
    for (const p of group.pieces) this.remoteHeld.add(p.index);
    group.el.classList.add('remote-held');
    group.el.style.zIndex = ++this.topZ;
    if (this.hintShown?.pieces.some((p) => p.group === group)) this.clearHint();
  }

  remoteMove(piece, nx, ny) {
    const group = this.puzzle.pieces[piece]?.group;
    if (!group || !this.isRemoteHeld(group)) return;
    const { x, y } = this.fromNormalized(nx, ny);
    group.el.classList.add('remote-moving'); // glides between the friend's updates
    this.placeGroup(group, x, y);
  }

  remoteRelease() {
    for (const group of this.groups) group.el.classList.remove('remote-held', 'remote-moving');
    this.remoteHeld.clear();
  }

  // The friend put a group down at (nx, ny); `pieces` includes every group it joined.
  remoteDrop(pieces, nx, ny) {
    this.remoteRelease();
    this.yieldTo(pieces);
    const groups = [...new Set(pieces.map((i) => this.puzzle.pieces[i]?.group).filter(Boolean))];
    if (!groups.length) return;
    const dropped = [...groups[0].pieces];
    let group = groups[0];
    for (const other of groups.slice(1)) group = this.merge(group, other);
    const { x, y } = this.fromNormalized(nx, ny);
    group.el.style.zIndex = ++this.topZ;
    group.el.classList.add('remote-moving');
    this.placeGroup(group, x, y);
    setTimeout(() => group.el.classList.remove('remote-moving'), 200);
    if (groups.length > 1) {
      playSnap();
      this.snapEffect(group, dropped);
      this.onProgress?.(this.progress(), this.connectedPieces(), this.puzzle.pieces.length);
      if (this.groups.size === 1) this.complete();
    }
  }

  // Replaces the whole table with the shared one (after this screen fell out of step).
  applyLayout(layout, held = []) {
    this.cancelDrag();
    this.clearHint();
    this.pouch?.remove(); // joining a game that's already under way: the pieces are out
    this.table.classList.remove('in-pouch');
    for (const group of this.groups) group.el.remove();
    this.groups.clear();
    this.remoteHeld.clear();
    this.restoreLayout(layout.map((entry, i) => ({ ...entry, z: i + 1 })));
    if (held.length) this.remoteGrab(held);
    this.onProgress?.(this.progress(), this.connectedPieces(), this.puzzle.pieces.length);
  }

  /* ---------- Undo and edge filter ---------- */

  canUndo() {
    return this.history.length > 0;
  }

  // Glides the last moved piece (or group) back to where it was picked up.
  undo() {
    if (!this.ready || this.paused || this.drag) return false;
    const last = this.history.pop();
    if (!last || !this.groups.has(last.group)) return false;
    const { group } = last;
    const from = { x: group.x, y: group.y };
    group.el.style.zIndex = ++this.topZ;
    group.x = last.x;
    group.y = last.y;
    this.applyPosition(group);
    group.el.animate([
      { transform: `translate(${from.x}px, ${from.y}px)` },
      { transform: `translate(${group.x}px, ${group.y}px)` },
    ], { duration: 320, easing: 'cubic-bezier(.3, .7, .3, 1)' });
    this.clearHint();
    this.onChange?.();
    return true;
  }

  // Dims the loose inner pieces so the edge pieces stand out.
  setEdgesOnly(on) {
    this.table.classList.toggle('edges-only', on);
  }

  /* ---------- Hints ---------- */

  // Highlights two pieces that fit together. Prefers a piece that joins the biggest group,
  // so hints help the puzzle grow from where the player is working.
  hint() {
    if (!this.ready || this.paused || this.groups.size < 2) return false;
    const bySize = [...this.groups].sort((a, b) => b.pieces.length - a.pieces.length);
    for (const group of bySize) {
      const pairs = [];
      for (const piece of group.pieces) {
        for (const neighbor of this.neighbors(piece)) {
          if (neighbor.group !== group) pairs.push([piece, neighbor]);
        }
      }
      if (pairs.length) {
        const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
        this.showHint(a, b);
        this.hintsUsed++;
        return true;
      }
    }
    return false;
  }

  showHint(a, b) {
    this.clearHint();
    if (this.view.zoom > this.fitZoom() * 1.001) this.resetView(); // both pieces in sight
    // Bring both into view: the bigger group first, then the piece to move on top of it.
    a.group.el.style.zIndex = ++this.topZ;
    b.group.el.style.zIndex = ++this.topZ;
    a.canvas.classList.add('hinted');
    b.canvas.classList.add('hinted');

    // A dashed line between the two pieces' centres.
    const { pieceW, pieceH, pad } = this.puzzle;
    const centre = (p) => ({ x: p.group.x + p.ox + pad + pieceW / 2, y: p.group.y + p.oy + pad + pieceH / 2 });
    const from = centre(a);
    const to = centre(b);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'hint-line');
    svg.innerHTML = `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>` +
      `<circle cx="${from.x}" cy="${from.y}" r="5"/><circle cx="${to.x}" cy="${to.y}" r="5"/>`;
    this.world.append(svg);

    this.hintShown = { pieces: [a, b], svg };
    this.hintTimer = setTimeout(() => this.clearHint(), 3200);
  }

  clearHint() {
    clearTimeout(this.hintTimer);
    if (!this.hintShown) return;
    for (const piece of this.hintShown.pieces) piece.canvas.classList.remove('hinted');
    this.hintShown.svg.remove();
    this.hintShown = null;
  }

  // Share of the joins made so far, from 0 to 1.
  progress() {
    const total = this.puzzle.pieces.length;
    return (total - this.groups.size) / (total - 1);
  }

  // Pieces that are joined to at least one other piece.
  connectedPieces() {
    let count = 0;
    for (const group of this.groups) if (group.pieces.length > 1) count += group.pieces.length;
    return count;
  }

  /* ---------- Finished ---------- */

  complete() {
    this.ready = false;
    this.resetView(); // step back to see the whole picture
    const [group] = this.groups;
    this.settleNow(group);
    group.el.style.transformOrigin = '';
    const { width, height, scaled } = this.puzzle;

    // Slide the finished puzzle onto the work mat…
    const { x, y } = this.workArea();
    this.mat.classList.add('done');
    group.el.animate([
      { transform: `translate(${group.x}px, ${group.y}px)` },
      { transform: `translate(${x}px, ${y}px)` },
    ], { duration: 700, easing: 'ease-in-out' });
    group.x = x;
    group.y = y;
    this.applyPosition(group);

    // …and let the clean photo fade in over the seams.
    const photo = document.createElement('canvas');
    photo.className = 'final-photo';
    photo.width = scaled.width;
    photo.height = scaled.height;
    photo.style.width = `${width}px`;
    photo.style.height = `${height}px`;
    photo.getContext('2d').drawImage(scaled, 0, 0);
    group.el.append(photo);
    photo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1200, delay: 700, fill: 'backwards' });

    // A band of light sweeps across the finished picture…
    const sweep = document.createElement('div');
    sweep.className = 'final-sweep';
    sweep.style.width = `${width}px`;
    sweep.style.height = `${height}px`;
    sweep.append(document.createElement('span'));
    group.el.append(sweep);
    sweep.firstChild.animate([{ transform: 'translateX(-120%) skewX(-18deg)' }, { transform: 'translateX(320%) skewX(-18deg)' }],
      { duration: 1300, delay: 1500, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });

    // …and a frame grows around it, ready to hang in the gallery.
    const frame = document.createElement('div');
    frame.className = 'final-frame';
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    group.el.append(frame);
    frame.animate([
      { opacity: 0, transform: 'scale(1.06)' },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: 700, delay: 2200, easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'backwards' });

    playComplete();
    confetti(this.table);
    this.onComplete?.();
  }

  // Glides the framed puzzle (smaller if needed) into the free space beside or above the
  // result card, so the card never covers it.
  makeRoomForCard(card) {
    const group = [...this.groups][0];
    if (!group || this.groups.size !== 1) return;
    const view = this.table.getBoundingClientRect();
    // The card's resting place: layout offsets ignore its slide-in animation.
    const parent = card.offsetParent.getBoundingClientRect();
    const cardLeft = parent.left + card.offsetLeft - view.left;
    const cardTop = parent.top + card.offsetTop - view.top;
    const beside = cardLeft > view.width / 2;
    const margin = 24;
    const screen = beside
      ? { x: margin, y: margin, w: cardLeft - margin * 2, h: view.height - margin * 2 }
      : { x: margin, y: margin, w: view.width - margin * 2, h: cardTop - margin * 2 };
    // From the screen to the table's own units (they differ on a scaled table).
    const { x: vx, y: vy, zoom } = this.view;
    const area = { x: (screen.x - vx) / zoom, y: (screen.y - vy) / zoom, w: screen.w / zoom, h: screen.h / zoom };

    const frameBorder = 16;
    const { width, height } = this.puzzle;
    const outerW = width + frameBorder * 2;
    const outerH = height + frameBorder * 2;
    const scale = Math.min(1, area.w / outerW, area.h / outerH);
    if (scale <= 0.2) return; // no sensible room (very small screen): leave it where it is
    const x = area.x + (area.w - outerW * scale) / 2 + frameBorder * scale;
    const y = area.y + (area.h - outerH * scale) / 2 + frameBorder * scale;
    group.el.style.transformOrigin = '0 0';
    group.el.animate([
      { transform: `translate(${group.x}px, ${group.y}px)` },
      { transform: `translate(${x}px, ${y}px) scale(${scale})` },
    ], { duration: 700, easing: 'cubic-bezier(.3, .7, .2, 1)' });
    group.el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  /* ---------- Table ---------- */

  async setTable(id) {
    this.tableId = id;
    // Show the surface's main colour right away; the detailed texture follows once drawn.
    this.table.style.backgroundColor = getTable(id).color;
    const url = await tableTextureUrl(id);
    if (this.tableId !== id) return;
    // On the world, so the table's grain moves and grows with the pieces when zooming.
    this.world.style.backgroundImage = `url(${url})`;
    this.world.style.backgroundSize = `${getTable(id).tile}px auto`; // repeat at life-size
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.sharpenTimer);
    this.clearHint();
    if (this.motion) cancelAnimationFrame(this.motion.frame);
    cancelAnimationFrame(this.edgeFrame);
    for (const [type, fn] of Object.entries(this.handlers)) this.table.removeEventListener(type, fn);
    window.removeEventListener('resize', this.onResize);
    this.table.classList.remove('in-pouch', 'zoomed', 'panning');
    this.table.style.backgroundImage = '';
    this.table.replaceChildren();
  }
}

// Edge pieces have at least one straight side.
function isInterior(piece, { cols, rows }) {
  return piece.col > 0 && piece.row > 0 && piece.col < cols - 1 && piece.row < rows - 1;
}

// The area a group's pieces cover, in puzzle space (tabs not included).
function groupBounds(pieces, { pieceW, pieceH }) {
  const cols = pieces.map((p) => p.col);
  const rows = pieces.map((p) => p.row);
  return {
    left: Math.min(...cols) * pieceW,
    top: Math.min(...rows) * pieceH,
    right: (Math.max(...cols) + 1) * pieceW,
    bottom: (Math.max(...rows) + 1) * pieceH,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function viewTransform(x, y, zoom) {
  return `translate(${x}px, ${y}px) scale(${zoom})`;
}
