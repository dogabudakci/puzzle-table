// Cuts a photo into jigsaw pieces.
//
// Every inner edge is generated once and shared by the two pieces on either side of it,
// so one gets the tab and the other the matching slot. Coordinates are in "puzzle space":
// CSS pixels with (0, 0) at the top-left corner of the finished puzzle.

// One tab as cubic bezier segments [c1t, c1n, c2t, c2n, t, n]:
// t runs along the edge (0 → 1), n is how far the point sticks out (positive = tab side).
const TAB_CURVE = [
  [0.00, 0.00, 0.35, -0.15, 0.37, -0.05],
  [0.37, -0.05, 0.40, 0.00, 0.38, 0.05],
  [0.38, 0.05, 0.20, 0.20, 0.50, 0.20],
  [0.50, 0.20, 0.80, 0.20, 0.62, 0.05],
  [0.62, 0.05, 0.60, 0.00, 0.63, -0.05],
  [0.65, -0.15, 1.00, 0.00, 1.00, 0.00],
];
const TAB_HEIGHT = 1.25;  // scales the curve's n values relative to the piece size
const SHADOW_ROOM = 5;    // extra canvas margin so the drop shadow isn't cut off

// Points of one edge from a to b: the start point, then 3 points per bezier segment.
function buildEdge(ax, ay, bx, by, size, rng) {
  const len = Math.hypot(bx - ax, by - ay);
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  const sign = rng() < 0.5 ? 1 : -1;
  const nx = -dy * sign;
  const ny = dx * sign;

  // Small random variations so no two tabs look identical.
  const shift = (rng() - 0.5) * 0.08 * size;
  const width = size * (0.9 + rng() * 0.2);
  const height = size * TAB_HEIGHT * (0.9 + rng() * 0.2);

  const points = [[ax, ay]];
  for (const seg of TAB_CURVE) {
    for (let i = 0; i < 6; i += 2) {
      const t = seg[i];
      const n = seg[i + 1] * height;
      const along = t === 0 ? 0 : t === 1 ? len : len / 2 + shift + (t - 0.5) * width;
      points.push([ax + dx * along + nx * n, ay + dy * along + ny * n]);
    }
  }
  return points;
}

function straightEdge(ax, ay, bx, by) {
  return [[ax, ay], [ax, ay], [bx, by], [bx, by]];
}

function traceEdge(path, points, reverse, ox, oy) {
  const pts = reverse ? [...points].reverse() : points;
  for (let i = 1; i < pts.length; i += 3) {
    path.bezierCurveTo(
      pts[i][0] - ox, pts[i][1] - oy,
      pts[i + 1][0] - ox, pts[i + 1][1] - oy,
      pts[i + 2][0] - ox, pts[i + 2][1] - oy,
    );
  }
}

// hEdges[r][c]: edge under piece (c, r), drawn left → right.
// vEdges[r][c]: edge right of piece (c, r), drawn top → bottom.
function buildEdges(cols, rows, pieceW, pieceH, rng) {
  const size = Math.min(pieceW, pieceH);
  const hEdges = [];
  for (let r = 0; r < rows - 1; r++) {
    hEdges.push([]);
    for (let c = 0; c < cols; c++) {
      const y = (r + 1) * pieceH;
      hEdges[r].push(buildEdge(c * pieceW, y, (c + 1) * pieceW, y, size, rng));
    }
  }
  const vEdges = [];
  for (let r = 0; r < rows; r++) {
    vEdges.push([]);
    for (let c = 0; c < cols - 1; c++) {
      const x = (c + 1) * pieceW;
      vEdges[r].push(buildEdge(x, r * pieceH, x, (r + 1) * pieceH, size, rng));
    }
  }
  return { hEdges, vEdges };
}

// Outline of piece (c, r), clockwise: top, right, bottom, left. Shared edges are stored
// left → right and top → bottom, so the bottom and left ones are traced in reverse.
// (ox, oy) is subtracted from every point, to draw in a piece's own canvas.
function piecePath({ hEdges, vEdges }, c, r, cols, rows, pieceW, pieceH, ox = 0, oy = 0) {
  const left = c * pieceW;
  const top = r * pieceH;
  const right = left + pieceW;
  const bottom = top + pieceH;
  const path = new Path2D();
  path.moveTo(left - ox, top - oy);
  if (r > 0) traceEdge(path, hEdges[r - 1][c], false, ox, oy);
  else traceEdge(path, straightEdge(left, top, right, top), false, ox, oy);
  if (c < cols - 1) traceEdge(path, vEdges[r][c], false, ox, oy);
  else traceEdge(path, straightEdge(right, top, right, bottom), false, ox, oy);
  if (r < rows - 1) traceEdge(path, hEdges[r][c], true, ox, oy);
  else traceEdge(path, straightEdge(right, bottom, left, bottom), false, ox, oy);
  if (c > 0) traceEdge(path, vEdges[r][c - 1], true, ox, oy);
  else traceEdge(path, straightEdge(left, bottom, left, top), false, ox, oy);
  path.closePath();
  return path;
}

// The cut lines of a whole puzzle, plus the outline of any single piece (in puzzle space),
// for drawing finished-puzzle pictures such as previews.
export function puzzleOutline(cols, rows, width, height, rng = Math.random) {
  const pieceW = width / cols;
  const pieceH = height / rows;
  const edges = buildEdges(cols, rows, pieceW, pieceH, rng);
  const lines = new Path2D();
  for (const edge of [...edges.hEdges.flat(), ...edges.vEdges.flat()]) {
    lines.moveTo(edge[0][0], edge[0][1]);
    traceEdge(lines, edge, false, 0, 0);
  }
  return { lines, piece: (c, r) => piecePath(edges, c, r, cols, rows, pieceW, pieceH) };
}

// Just the cut lines between pieces, for drawing a preview of the puzzle.
export function cutLines(cols, rows, width, height, rng = Math.random) {
  return puzzleOutline(cols, rows, width, height, rng).lines;
}

// A repeatable random sequence, so a preview doesn't change shape every time it's redrawn.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds every piece of the puzzle.
//   source: canvas with the photo; cols/rows: grid; width/height: puzzle size in CSS px.
export function cutPuzzle(source, cols, rows, width, height, rng = Math.random) {
  const pieceW = width / cols;
  const pieceH = height / rows;
  const size = Math.min(pieceW, pieceH);
  const pad = Math.ceil(size * 0.3) + SHADOW_ROOM;
  const dpr = window.devicePixelRatio || 1;
  const edges = buildEdges(cols, rows, pieceW, pieceH, rng);

  // The photo scaled once to puzzle size, so each piece copies just its own patch.
  const scaled = scalePhoto(source, width, height, dpr);

  const pieces = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Top-left of this piece's canvas in puzzle space.
      const ox = c * pieceW - pad;
      const oy = r * pieceH - pad;
      const path = piecePath(edges, c, r, cols, rows, pieceW, pieceH, ox, oy);

      const canvasW = pieceW + pad * 2;
      const canvasH = pieceH + pad * 2;
      const canvas = document.createElement('canvas');
      canvas.className = 'piece';
      canvas.dataset.index = pieces.length;
      canvas.width = Math.ceil(canvasW * dpr);
      canvas.height = Math.ceil(canvasH * dpr);
      canvas.style.width = `${canvasW}px`;
      canvas.style.height = `${canvasH}px`;

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      drawPiece(ctx, path, scaled, ox, oy, canvasW, canvasH, width, height, dpr);

      pieces.push({ index: pieces.length, col: c, row: r, ox, oy, canvas, ctx, path });
    }
  }

  return { cols, rows, width, height, pieceW, pieceH, pad, dpr, scaled, pieces, source };
}

function scalePhoto(source, width, height, resolution) {
  const scaled = document.createElement('canvas');
  scaled.width = Math.round(width * resolution);
  scaled.height = Math.round(height * resolution);
  const ctx = scaled.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
  return scaled;
}

// The most canvas pixels per CSS pixel worth drawing: more than the photo has adds nothing,
// and the total is capped so a big puzzle can't use up a phone's memory.
export function maxResolution(puzzle) {
  const { source, width, height, pad, pieceW, pieceH, pieces } = puzzle;
  const fromPhoto = Math.min(source.width / width, source.height / height);
  const area = pieces.length * (pieceW + pad * 2) * (pieceH + pad * 2);
  const fromMemory = Math.sqrt(40e6 / area); // about 160 MB of piece pixels at most
  return Math.max(1, Math.min(fromPhoto, fromMemory));
}

// Draws the pieces again at `resolution` canvas pixels per CSS pixel, a batch at a time
// (sharper when the table is zoomed in). Resolves once all are done, or false if cancelled.
export async function redrawPieces(puzzle, resolution, isCancelled = () => false) {
  const { width, height, pad, pieceW, pieceH, pieces } = puzzle;
  const scaled = scalePhoto(puzzle.source, width, height, resolution);
  const canvasW = pieceW + pad * 2;
  const canvasH = pieceH + pad * 2;
  for (let i = 0; i < pieces.length; i++) {
    if (i % 24 === 0) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (isCancelled()) return false;
    }
    const { canvas, ctx, path, ox, oy } = pieces[i];
    canvas.width = Math.ceil(canvasW * resolution); // also clears it and resets the context
    canvas.height = Math.ceil(canvasH * resolution);
    ctx.scale(resolution, resolution);
    drawPiece(ctx, path, scaled, ox, oy, canvasW, canvasH, width, height, resolution);
  }
  puzzle.scaled = scaled;
  puzzle.dpr = resolution;
  return true;
}

function drawPiece(ctx, path, scaled, ox, oy, canvasW, canvasH, width, height, dpr) {
  // Soft shadow under the piece.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();

  ctx.save();
  ctx.clip(path);

  // Copy only the part of the photo under this canvas (clamped to the photo's bounds).
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(width, ox + canvasW);
  const y1 = Math.min(height, oy + canvasH);
  ctx.drawImage(scaled,
    x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr,
    x0 - ox, y0 - oy, x1 - x0, y1 - y0);

  // Bevel: light along the top-left edges, dark along the bottom-right.
  ctx.lineWidth = 2;
  ctx.translate(1, 1);
  ctx.strokeStyle = 'rgba(255, 255, 255, .35)';
  ctx.stroke(path);
  ctx.translate(-2, -2);
  ctx.strokeStyle = 'rgba(0, 0, 0, .3)';
  ctx.stroke(path);
  ctx.translate(1, 1);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, .25)';
  ctx.stroke(path);
  ctx.restore();
}

export function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
