// A few tips shown during the first game (and again from Settings): a small card at the bottom
// of the table that doesn't stop the player from playing.

import { icon } from './icons.js';

const SEEN_KEY = 'puzzle-guide-seen';

const TIPS = [
  {
    icon: 'i-pieces',
    title: 'Drag the pieces',
    text: 'Pieces that belong together snap into place when you bring them close. Build the picture on the mat in the middle.',
  },
  {
    icon: 'i-fit',
    title: 'Zoom in for a closer look',
    text: 'Pinch, or use the mouse wheel, to zoom. Drag the empty table to look around. The buttons in the corner do the same.',
  },
  {
    icon: 'i-hint',
    title: 'A little help',
    text: 'The bulb shows two pieces that fit. The edge button fades the inner pieces, so the border is easier to find.',
  },
];

export function guideSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // without storage it would show every time: better not at all
  }
}

function markSeen(seen = true) {
  try {
    if (seen) localStorage.setItem(SEEN_KEY, '1');
    else localStorage.removeItem(SEEN_KEY);
  } catch {
    // Storage unavailable.
  }
}

// Shows the tips again in the next game.
export function resetGuide() {
  markSeen(false);
}

// Shows the tips in `container` (the game screen). Returns a function that closes them.
export function showGuide(container) {
  const card = document.createElement('section');
  card.className = 'guide';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Tips');
  let step = 0;

  function close() {
    markSeen();
    card.classList.add('leaving');
    card.addEventListener('animationend', () => card.remove(), { once: true });
    setTimeout(() => card.remove(), 400); // in case animations are off
  }

  function render() {
    const tip = TIPS[step];
    const badge = document.createElement('span');
    badge.className = 'guide-icon';
    badge.append(icon(tip.icon));
    const title = document.createElement('h3');
    title.textContent = tip.title;
    const text = document.createElement('p');
    text.textContent = tip.text;
    const dots = document.createElement('span');
    dots.className = 'guide-dots';
    dots.setAttribute('aria-label', `Tip ${step + 1} of ${TIPS.length}`);
    for (let i = 0; i < TIPS.length; i++) {
      const dot = document.createElement('i');
      if (i === step) dot.className = 'on';
      dots.append(dot);
    }
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn ghost small';
    skip.textContent = 'Skip';
    skip.addEventListener('click', close);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn primary small';
    next.textContent = step === TIPS.length - 1 ? 'Got it' : 'Next';
    next.addEventListener('click', () => {
      if (step === TIPS.length - 1) return close();
      step++;
      render();
    });
    const actions = document.createElement('div');
    actions.className = 'guide-actions';
    actions.append(dots, step < TIPS.length - 1 ? skip : document.createElement('span'), next);
    card.replaceChildren(badge, title, text, actions);
    next.focus({ preventScroll: true });
  }

  render();
  container.append(card);
  return close;
}
