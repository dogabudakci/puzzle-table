// The gallery room: finished puzzles framed on the wall, achievements on the shelf, and the
// close-up view of one puzzle. (Drawing the room itself is in gallery.js.)

import { $, app, state, screens, showScreen } from './app.js';
import { savePuzzle, listPuzzles, deletePuzzle, listAchievements, saveAchievements, puzzleImage } from './library.js';
import { ACHIEVEMENTS, newlyEarned } from './achievements.js';
import { renderGallery, renderViewer } from './gallery.js';
import { tableTextureUrl } from './textures.js';
import { icon } from './icons.js';

const viewer = $('viewer');


// Big enough to look sharp on screen, small enough (about 250 KB) to keep accounts light.
const GALLERY_IMAGE_SIDE = 1400;

function photoBlob(source) {
  const scale = Math.min(1, GALLERY_IMAGE_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve({ blob, canvas }), 'image/jpeg', 0.82));
}

// Hangs the finished puzzle in the gallery and reports any new achievements on the complete card.
export async function saveToGallery(result) {
  const savedNote = $('saved-note');
  const { photo, pieces, table } = state; // read now: the player may start another game meanwhile
  try {
    const { blob, canvas } = await photoBlob(photo.canvas);
    await savePuzzle({
      createdAt: Date.now(),
      name: photo.name,
      image: blob,
      imageW: canvas.width,
      imageH: canvas.height,
      pieces: pieces.count,
      cols: pieces.cols,
      rows: pieces.rows,
      table,
      ...result,
    });

    const [puzzles, earned] = await Promise.all([listPuzzles(), listAchievements()]);
    const fresh = newlyEarned(puzzles, new Set(earned.map((a) => a.id)));
    if (fresh.length) await saveAchievements(fresh.map((a) => ({ id: a.id, earnedAt: Date.now() })));
    showGalleryCount(puzzles.length);

    savedNote.replaceChildren(icon('i-check'), 'Framed and hung in your gallery');
    $('new-medals').replaceChildren(...fresh.map((a, i) => {
      const medal = document.createElement('span');
      medal.className = 'new-medal';
      medal.style.animationDelay = `${1.8 + i * 0.25}s`;
      const coin = document.createElement('span');
      coin.className = 'coin';
      coin.append(icon(a.icon, 'coin-icon'));
      medal.append(coin, `Achievement unlocked: ${a.name}`);
      return medal;
    }));
  } catch (err) {
    console.error(err);
    savedNote.textContent = "Couldn't save to your gallery: this browser isn't allowing storage.";
  }
}

export function showGalleryCount(count) {
  const badge = $('gallery-count');
  badge.textContent = count;
  badge.hidden = count === 0;
}

let openPuzzle = null; // the puzzle shown in the close-up view

export async function showGallery() {
  showScreen(screens.gallery);
  tableTextureUrl('oak').then((url) => { $('floor').style.backgroundImage = `url(${url})`; });

  const parts = {
    shelf: $('achievement-shelf'),
    frames: $('frames'),
    emptyNote: $('empty-wall'),
    stats: $('gallery-stats'),
  };
  try {
    const [puzzles, earned] = await Promise.all([listPuzzles(), listAchievements()]);
    // Catch up on anything missed, e.g. if the page closed while a finished puzzle was saving.
    const missed = newlyEarned(puzzles, new Set(earned.map((a) => a.id)))
      .map((a) => ({ id: a.id, earnedAt: Date.now() }));
    if (missed.length) {
      await saveAchievements(missed);
      earned.push(...missed);
    }
    showGalleryCount(puzzles.length);
    renderGallery({
      ...parts,
      puzzles,
      earned: new Map(earned.filter((a) => ACHIEVEMENTS.some((x) => x.id === a.id)).map((a) => [a.id, a.earnedAt])),
      onOpen: (puzzle) => {
        openPuzzle = puzzle;
        renderViewer($('viewer-body'), puzzle);
        resetDeleteButton();
        viewer.showModal();
      },
    });
  } catch (err) {
    console.error(err);
    parts.emptyNote.textContent = "Your gallery can't be opened: this browser isn't allowing storage.";
    parts.emptyNote.hidden = false;
  }
}

function hideGallery() {
  showScreen(screens.setup);
  app.drawPreview();
}

$('open-gallery').addEventListener('click', showGallery);
$('gallery-back-btn').addEventListener('click', hideGallery);
$('view-gallery-btn').addEventListener('click', () => {
  app.stopGame();
  showGallery();
});

$('viewer-close').addEventListener('click', () => viewer.close());
// Clicking the dimmed backdrop (outside the dialog box) closes it too.
viewer.addEventListener('click', (e) => {
  if (e.target !== viewer) return;
  const r = viewer.getBoundingClientRect();
  const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (outside) viewer.close();
});

$('viewer-download').addEventListener('click', async () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await puzzleImage(openPuzzle));
  link.download = `${openPuzzle.name.replace(/\.[^.]+$/, '')}-puzzle.jpg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

$('viewer-replay').addEventListener('click', async () => {
  const { name } = openPuzzle;
  const image = await puzzleImage(openPuzzle);
  viewer.close();
  hideGallery();
  window.scrollTo(0, 0);
  await app.handleFile(new File([image], name, { type: image.type }));
});

// Removing asks for a second click to confirm.
const deleteBtn = $('viewer-delete');
function resetDeleteButton() {
  deleteBtn.dataset.confirm = '';
  deleteBtn.querySelector('span').textContent = 'Remove';
}
deleteBtn.addEventListener('click', async () => {
  if (!deleteBtn.dataset.confirm) {
    deleteBtn.dataset.confirm = 'yes';
    deleteBtn.querySelector('span').textContent = 'Click again to remove';
    return;
  }
  await deletePuzzle(openPuzzle.id);
  viewer.close();
  showGallery();
});
