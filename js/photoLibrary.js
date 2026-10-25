import { t, photoName } from './i18n.js';
// Built-in photos the player can puzzle instead of uploading their own.
// The list comes from assets/library/library.json, which tools/build_library.py writes from the
// photos dropped into the `library/` folder: each photo has {id}.jpg and a small {id}-thumb.jpg.

const LIBRARY_DIR = 'assets/library';

// A library picture's address: WebP when there is one (smaller), and the photo's hash, so the
// browser can keep it for good and still notices when the photo is replaced.
function pictureUrl(photo, suffix = '') {
  const ext = photo.webp ? 'webp' : 'jpg';
  return `${LIBRARY_DIR}/${photo.id}${suffix}.${ext}${photo.hash ? `?v=${photo.hash}` : ''}`;
}

export const libraryThumbUrl = (photo) => pictureUrl(photo, '-thumb');

// Thumbnails load only when their grid is about to scroll into view (the browser's own lazy
// loading starts far too early here, fetching all of them with the start page).
const nearView = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.src = entry.target.dataset.src;
      nearView.unobserve(entry.target);
    }
  }, { rootMargin: '300px' })
  : null;

function lazyImage(img, src) {
  if (!nearView) {
    img.src = src;
    return;
  }
  img.dataset.src = src;
  nearView.observe(img);
}

export async function loadLibrary() {
  try {
    const response = await fetch(`${LIBRARY_DIR}/library.json`, { cache: 'no-store' });
    if (!response.ok) return [];
    const { photos } = await response.json();
    return Array.isArray(photos) ? photos : [];
  } catch {
    return [];
  }
}

// Fetches a library photo as a File, so it goes through the same checks as an upload.
export async function fetchLibraryPhoto(photo) {
  const response = await fetch(pictureUrl(photo));
  if (!response.ok) throw new Error(response.statusText);
  const blob = await response.blob();
  return new File([blob], `${photo.name}.${photo.webp ? 'webp' : 'jpg'}`, { type: blob.type || 'image/jpeg' });
}

// A grid of thumbnails, filled once the list has loaded; `onEmpty` runs if there are no photos.
// `select(id)` marks one as chosen (or none, for an uploaded photo).
export function createPhotoLibrary(onPick, onEmpty) {
  const wrap = document.createElement('div');
  wrap.className = 'photo-library';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', t('start.photoLibrary'));
  let selected = null;

  loadLibrary().then((photos) => {
    if (!photos.length) {
      onEmpty?.();
      return;
    }
    for (const photo of photos) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-photo';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(photo.id === selected));
      button.setAttribute('aria-label', photoName(photo));
      button.dataset.id = photo.id;

      const thumb = document.createElement('img');
      lazyImage(thumb, libraryThumbUrl(photo));
      thumb.alt = '';
      const name = document.createElement('span');
      name.textContent = photoName(photo);
      button.append(thumb, name);

      button.addEventListener('click', () => onPick(photo));
      wrap.append(button);
    }
  });

  const select = (id) => {
    selected = id;
    for (const b of wrap.children) b.setAttribute('aria-checked', String(b.dataset.id === id));
  };
  return { element: wrap, select };
}
