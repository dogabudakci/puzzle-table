// Which piece counts make sense for a photo, and how each count is laid out as a grid.

const PIECE_COUNTS = [12, 24, 48, 100, 144, 200, 300, 500];

// A piece must cover at least this many pixels of the original photo, or it looks blurry.
const MIN_SOURCE_PIECE = 40;
// A piece must be at least this big (CSS px) on the table, or it's too fiddly to grab.
const MIN_SCREEN_PIECE = 28;

// Picks columns × rows close to the target count, keeping pieces roughly square.
export function gridFor(count, aspect) {
  const cols = Math.max(2, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(2, Math.round(count / cols));
  return { cols, rows };
}

// Size of the finished puzzle on the table; the rest of the table is room for loose pieces.
export function puzzleSizeOnScreen(aspect, viewW, viewH) {
  const maxW = viewW * 0.55;
  const maxH = viewH * 0.6;
  return maxW / maxH > aspect
    ? { width: maxH * aspect, height: maxH }
    : { width: maxW, height: maxW / aspect };
}

export function pieceOptions(width, height, viewW, viewH) {
  const aspect = width / height;
  const screen = puzzleSizeOnScreen(aspect, viewW, viewH);
  const seen = new Set();
  const options = [];

  for (const target of PIECE_COUNTS) {
    const { cols, rows } = gridFor(target, aspect);
    const count = cols * rows;
    if (seen.has(count)) continue;
    seen.add(count);

    const sourcePiece = Math.min(width / cols, height / rows);
    const screenPiece = Math.min(screen.width / cols, screen.height / rows);
    let disabledReason = null;
    if (sourcePiece < MIN_SOURCE_PIECE) {
      disabledReason = 'Photo resolution is too low for this many pieces';
    } else if (screenPiece < MIN_SCREEN_PIECE) {
      disabledReason = 'Pieces would be too small on this screen';
    }

    options.push({ count, cols, rows, pieceW: width / cols, pieceH: height / rows, disabledReason });
  }
  return options;
}
