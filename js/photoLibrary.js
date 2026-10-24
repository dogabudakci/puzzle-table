// Built-in photos the player can puzzle instead of uploading their own.
// The list comes from assets/library/library.json, which tools/build_library.py writes from the
// photos dropped into the `library/` folder: each photo has {id}.jpg and a small {id}-thumb.jpg.

const LIBRARY_DIR = 'assets/library';

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
  const response = await fetch(`${LIBRARY_DIR}/${photo.id}.jpg`);
  if (!response.ok) throw new Error(response.statusText);
  const blob = await response.blob();
  return new File([blob], `${photo.name}.jpg`, { type: 'image/jpeg' });
}

// A grid of thumbnails, filled once the list has loaded; `onEmpty` runs if there are no photos.
// `select(id)` marks one as chosen (or none, for an uploaded photo).
export function createPhotoLibrary(onPick, onEmpty) {
  const wrap = document.createElement('div');
  wrap.className = 'photo-library';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'Photo library');
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
      button.setAttribute('aria-label', photo.name);
      button.dataset.id = photo.id;

      const thumb = document.createElement('img');
      thumb.src = `${LIBRARY_DIR}/${photo.id}-thumb.jpg`;
      thumb.alt = '';
      thumb.loading = 'lazy';
      const name = document.createElement('span');
      name.textContent = photo.name;
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
