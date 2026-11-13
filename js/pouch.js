import { t } from './i18n.js';
// The cloth pouch the pieces start in.

const POUCH_SVG = `
<svg viewBox="0 0 200 230" width="170" height="196" aria-hidden="true">
  <defs>
    <radialGradient id="pouch-cloth" cx="40%" cy="45%" r="70%">
      <stop offset="0" stop-color="#b8484f"/>
      <stop offset=".6" stop-color="#8c2f39"/>
      <stop offset="1" stop-color="#5e1c25"/>
    </radialGradient>
    <radialGradient id="pouch-light" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff6d8" stop-opacity=".95"/>
      <stop offset=".45" stop-color="#ffd98a" stop-opacity=".55"/>
      <stop offset="1" stop-color="#ffcf70" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="pouch-ruffle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a63c45"/>
      <stop offset="1" stop-color="#6d222c"/>
    </linearGradient>
  </defs>
  <ellipse cx="100" cy="218" rx="72" ry="9" fill="rgba(0,0,0,.28)"/>
  <!-- body -->
  <path d="M68 78 C22 100 8 178 46 206 C76 226 124 226 154 206 C192 178 178 100 132 78 Z" fill="url(#pouch-cloth)"/>
  <!-- folds -->
  <path d="M78 86 C64 120 60 160 70 200" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3" stroke-linecap="round"/>
  <path d="M122 86 C138 120 142 160 132 200" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3" stroke-linecap="round"/>
  <path d="M92 90 C86 120 88 150 84 176" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4" stroke-linecap="round"/>
  <!-- embroidered puzzle piece -->
  <g fill="none" stroke="#e8c27a" stroke-width="3" stroke-linejoin="round" opacity=".9">
    <path d="M84 132 h10 a6 6 0 1 1 12 0 h10 v10 a6 6 0 1 1 0 12 v10 h-10 a6 6 0 1 0 -12 0 h-10 v-10 a6 6 0 1 0 0 -12 Z"/>
  </g>
  <!-- light from inside, shown as the pouch opens -->
  <ellipse class="pouch-glow" cx="100" cy="52" rx="70" ry="44" fill="url(#pouch-light)"/>
  <!-- gathered mouth -->
  <g class="pouch-mouth">
    <path d="M58 40 C72 56 128 56 142 40 L130 76 C112 82 88 82 70 76 Z" fill="url(#pouch-ruffle)"/>
    <path d="M74 50 L80 74 M92 54 L94 78 M108 54 L106 78 M126 50 L120 74" stroke="rgba(0,0,0,.2)" stroke-width="2"/>
  </g>
  <!-- drawstring and bow -->
  <ellipse class="pouch-string" cx="100" cy="78" rx="34" ry="6" fill="none" stroke="#d9a94f" stroke-width="5"/>
  <g class="pouch-bow">
  <path d="M100 80 C82 70 70 86 84 92 C92 95 98 88 100 82 Z" fill="#d9a94f"/>
  <path d="M100 80 C118 70 130 86 116 92 C108 95 102 88 100 82 Z" fill="#d9a94f"/>
  <path d="M98 84 C94 100 88 110 84 120 M102 84 C108 100 114 108 120 116" fill="none" stroke="#d9a94f" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="100" cy="82" r="5" fill="#c28f3a"/>
  </g>
</svg>`;

// Gold sparkles bursting out of the mouth (viewport coords) as the pouch opens.
function sparkle(mouth) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'pouch-sparkles';
  layer.style.left = `${mouth.x}px`;
  layer.style.top = `${mouth.y}px`;
  document.body.append(layer);
  const flights = [];
  for (let i = 0; i < 22; i++) {
    const dot = document.createElement('span');
    const size = 3 + Math.random() * 5;
    dot.style.width = dot.style.height = `${size}px`;
    layer.append(dot);
    // Mostly upward, fanning out to the sides.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const distance = 50 + Math.random() * 110;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    flights.push(dot.animate([
      { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6}px)) scale(1)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 30}px)) scale(.3)`, opacity: 0 },
    ], { duration: 700 + Math.random() * 500, delay: Math.random() * 120, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'both' }).finished);
  }
  Promise.all(flights).finally(() => layer.remove());
}

export function createPouch(pieceCount, onOpen) {
  const pouch = document.createElement('button');
  pouch.type = 'button';
  pouch.className = 'pouch';
  pouch.setAttribute('aria-label', t('play.openPouchSpillPieces', { a: pieceCount }));
  pouch.innerHTML = `${POUCH_SVG}<span class="pouch-hint">${t('play.clickPouchSpillPieces', { a: pieceCount })}</span>`;

  pouch.addEventListener('click', () => {
    if (pouch.classList.contains('opening')) return;
    // Measure the mouth before the opening animation starts moving the pouch.
    const bag = pouch.querySelector('svg').getBoundingClientRect();
    const mouth = { x: bag.left + bag.width / 2, y: bag.top + bag.height * 0.3 };
    pouch.classList.add('opening');
    sparkle(mouth);
    onOpen(mouth);
    pouch.addEventListener('animationend', (e) => {
      if (e.target === pouch) pouch.remove();
    });
  });
  return pouch;
}
