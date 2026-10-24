// The daily puzzle: one library photo per day, cut the same way for everyone, plus the
// player's streak of days played. Days are local calendar dates ("2026-10-24").
// Finished days are kept in localStorage on this device, or in the player's account when signed in.

const DONE_KEY = 'puzzle-daily-done';
export const DAILY_PIECES = 100;

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// A stable number for a day, so everyone gets the same photo and the same cut.
export function daySeed(key) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// The day's photo. Consecutive days step through the library in a shuffled order, so the
// same photo doesn't come back until every other one has had its day.
export function dailyPhoto(photos, key) {
  if (!photos.length) return null;
  const sorted = [...photos].sort((a, b) => a.id.localeCompare(b.id));
  const [y, m, d] = key.split('-').map(Number);
  const dayNumber = Date.UTC(y, m - 1, d) / 86400000; // whole days, unaffected by daylight saving
  const round = Math.floor(dayNumber / sorted.length);
  // Shuffle the library differently for each round through it.
  const order = sorted.map((p) => ({ p, r: daySeed(`${round}:${p.id}`) }));
  order.sort((a, b) => a.r - b.r);
  return order[dayNumber % sorted.length].p;
}

// While signed in, the days come from the account instead: { days: Set, save(day) }.
let account = null;

export function useAccountDays(days, save) {
  account = days ? { days: new Set(days), save } : null;
}

function localDays() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

// The days played here as a guest, removed from this browser (they move into the account).
export function takeGuestDays() {
  const days = [...localDays()];
  try {
    localStorage.removeItem(DONE_KEY);
  } catch {
    // Storage unavailable: nothing was stored.
  }
  return days;
}

export function doneDays() {
  return account ? new Set(account.days) : localDays();
}

export function markDone(key) {
  if (account) {
    account.days.add(key);
    account.save(key);
    return new Set(account.days);
  }
  const days = localDays();
  days.add(key);
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...days].sort()));
  } catch {
    // Storage unavailable (private mode): the streak just won't be remembered.
  }
  return days;
}

// Days in a row up to today. Not having played yet today doesn't break it until tomorrow.
export function streak(days, today = dayKey()) {
  const date = parseKey(today);
  if (!days.has(today)) date.setDate(date.getDate() - 1);
  let count = 0;
  while (days.has(dayKey(date))) {
    count++;
    date.setDate(date.getDate() - 1);
  }
  return count;
}

export function msUntilTomorrow(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

// This month as a small calendar grid: played days filled, today ringed.
export function renderCalendar(container, days, today = dayKey()) {
  const date = parseKey(today);
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const total = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday

  const title = document.createElement('div');
  title.className = 'cal-title';
  title.textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const name of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
    const head = document.createElement('span');
    head.className = 'cal-head';
    head.textContent = name;
    grid.append(head);
  }
  for (let i = 0; i < lead; i++) grid.append(document.createElement('span'));
  for (let d = 1; d <= total; d++) {
    const key = dayKey(new Date(year, month, d));
    const cell = document.createElement('span');
    cell.className = 'cal-day';
    cell.textContent = d;
    if (days.has(key)) cell.classList.add('done');
    if (key === today) cell.classList.add('today');
    if (key > today) cell.classList.add('future');
    grid.append(cell);
  }
  container.replaceChildren(title, grid);
}
