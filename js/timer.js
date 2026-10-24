// Game clock: counts up, with an optional countdown limit.

export class GameTimer {
  // limitSeconds: null for a plain stopwatch.
  constructor({ limitSeconds = null, onTick, onExpire } = {}) {
    this.limit = limitSeconds ? limitSeconds * 1000 : null;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.spent = 0;       // ms counted before the current run
    this.runningSince = null;
    this.interval = null;
    this.expired = false;
  }

  get running() {
    return this.runningSince !== null;
  }

  get elapsed() {
    return this.spent + (this.running ? performance.now() - this.runningSince : 0);
  }

  // Time left on the countdown, or null without a limit.
  get remaining() {
    return this.limit === null ? null : Math.max(0, this.limit - this.elapsed);
  }

  start() {
    if (this.running) return;
    this.runningSince = performance.now();
    this.interval = setInterval(() => this.tick(), 250);
    this.tick();
  }

  pause() {
    if (!this.running) return;
    this.spent = this.elapsed;
    this.runningSince = null;
    clearInterval(this.interval);
    this.tick();
  }

  // Turns a countdown into a plain stopwatch (used for "keep going" after time runs out).
  removeLimit() {
    this.limit = null;
    this.tick();
  }

  tick() {
    this.onTick?.(this);
    if (this.limit !== null && this.remaining === 0 && !this.expired) {
      this.expired = true;
      this.pause();
      this.onExpire?.();
    }
  }
}

export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Roughly 12 seconds per piece, rounded up to 5 minutes.
export function suggestedMinutes(pieceCount) {
  return Math.max(5, Math.ceil(pieceCount * 12 / 60 / 5) * 5);
}
