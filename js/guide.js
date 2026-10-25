// A few tips shown during the first game (and again from Settings): a small card at the bottom
// of the table that doesn't stop the player from playing.

import { icon } from './icons.js';
import { t } from './i18n.js';

const SEEN_KEY = 'puzzle-guide-seen';

const TIPS = [
  {
    icon: 'i-pieces',
    title: t('tips.dragPieces'),
    text: t('tips.piecesBelongTogetherSnap'),
  },
  {
    icon: 'i-fit',
    title: t('tips.zoomCloserLook'),
    text: t('tips.pinchUseMouseWheel'),
  },
  {
    icon: 'i-hint',
    title: t('tips.littleHelp'),
    text: t('tips.bulbShowsTwoPieces'),
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
  card.setAttribute('aria-label', t('play.tips'));
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
    dots.setAttribute('aria-label', t('tips.tip', { a: step + 1, b: TIPS.length }));
    for (let i = 0; i < TIPS.length; i++) {
      const dot = document.createElement('i');
      if (i === step) dot.className = 'on';
      dots.append(dot);
    }
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn ghost small';
    skip.textContent = t('tips.skip');
    skip.addEventListener('click', close);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn primary small';
    next.textContent = step === TIPS.length - 1 ? t('tips.got') : t('tips.next');
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
