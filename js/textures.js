// Table surfaces: seamless photographic textures (CC0, from Poly Haven and ambientCG),
// stored in assets/tables/. `tile` is how wide one repeat of the texture is on screen (CSS px),
// chosen so wood grain, marble veins and fabric weave look life-size.

export const TABLES = [
  { id: 'oak', name: 'Oak', color: '#b28a62', tile: 900 },
  { id: 'walnut', name: 'Walnut', color: '#4a2a1a', tile: 900 },
  { id: 'white-marble', name: 'White marble', color: '#e6e6e8', tile: 1100 },
  { id: 'cream-marble', name: 'Cream marble', color: '#ddd0bb', tile: 1100 },
  { id: 'black-marble', name: 'Black marble', color: '#222224', tile: 1100 },
  { id: 'felt', name: 'Green felt', color: '#2b5f44', tile: 600 },
  { id: 'linen', name: 'Linen', color: '#d2c7b2', tile: 420 },
  { id: 'leather', name: 'Leather', color: '#4b2e1c', tile: 800 },
];

export const DEFAULT_TABLE = 'oak';

export function getTable(id) {
  return TABLES.find((t) => t.id === id) ?? TABLES[0];
}

const imageCache = new Map();

// Full-size texture URL, resolved once the image has loaded (so it never appears half-drawn).
export function tableTextureUrl(id) {
  const url = `assets/tables/${getTable(id).id}.webp`;
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(url); // fall back to the plain colour already showing
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

// A row of clickable swatches; calls onPick(id) when one is chosen.
export function createTablePicker(selectedId, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'table-picker';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'Table surface');

  for (const table of TABLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-swatch';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(table.id === selectedId));
    button.dataset.id = table.id;

    const thumb = document.createElement('img');
    thumb.src = `assets/tables/${table.id}-swatch.webp`;
    thumb.alt = '';
    thumb.style.backgroundColor = table.color;
    const name = document.createElement('span');
    name.textContent = table.name;
    button.append(thumb, name);

    button.addEventListener('click', () => {
      for (const b of wrap.children) b.setAttribute('aria-checked', String(b === button));
      onPick(table.id);
    });
    wrap.append(button);
  }
  return wrap;
}
