// One audio context for effects and music, unlocked by a real user gesture.
//
// Browsers sometimes leave it unable to play: Safari can hang on resume() or keep an
// "interrupted" context after sleep, a call or a change of headphones, and a context can say
// "running" while its clock stands still. Every gesture checks, and a stuck context is replaced
// by a new one (made inside the gesture, so it's allowed to play); music then starts again on
// it (see onAudioRestart).
let context = null;
let resumeSince = 0;  // when a resume() that hasn't worked yet was first asked for
let clockCheck = null; // { wall, audio }: the context's clock at the last gesture, to spot it frozen
const restartListeners = new Set();

const RESUME_TIMEOUT = 2000; // ms a resume() may take before the context counts as stuck

export function getAudioContext() {
  if (!context || context.state === 'closed') {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Audio playback is unavailable in this browser.');
    context = new AudioContext();
    resumeSince = 0;
    clockCheck = null;
  }
  return context;
}

// fn(context) runs when a stuck context has been replaced by a new one.
export function onAudioRestart(fn) {
  restartListeners.add(fn);
}

// Rejects if `promise` hasn't settled within `ms` (audio start-up can hang, e.g. in Safari),
// with an Error whose code is 'timeout'.
export function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'timeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function resumeAudio() {
  const ctx = getAudioContext();
  // Safari can report "interrupted" as well as "suspended".
  if (ctx.state !== 'running') {
    if (!resumeSince) resumeSince = performance.now();
    await withTimeout(ctx.resume(), RESUME_TIMEOUT, 'Audio start-up timed out');
  }
  if (ctx.state !== 'running') throw new Error('Audio playback has not resumed.');
  if (ctx === context) resumeSince = 0;
  return ctx;
}

// Whether the context can't be brought back by resume() and needs replacing.
function isStuck(ctx) {
  const now = performance.now();
  if (ctx.state !== 'running') {
    clockCheck = null;
    return ctx.state === 'interrupted' || (resumeSince > 0 && now - resumeSince > RESUME_TIMEOUT);
  }
  // Running: its clock should have moved on with the wall clock since the last gesture.
  const last = clockCheck;
  clockCheck = { wall: now, audio: ctx.currentTime };
  const wallSeconds = last ? (now - last.wall) / 1000 : 0;
  return wallSeconds > 1 && ctx.currentTime - last.audio < wallSeconds * 0.1;
}

function replaceContext() {
  const old = context;
  context = null;
  old?.close().catch(() => {});
  const fresh = getAudioContext();
  console.warn('Puzzle sound was stuck; started it again.');
  for (const fn of restartListeners) fn(fresh);
}

function unlockAudio() {
  // A blocked attempt is retried on the next gesture. Call resume synchronously
  // inside the event, before a drag or an asynchronous action loses activation.
  if (context && isStuck(context)) replaceContext();
  void resumeAudio().catch(() => {});
}

for (const event of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
  document.addEventListener(event, unlockAudio, { capture: true, passive: true });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && context) void resumeAudio().catch(() => {});
});
window.addEventListener('pageshow', () => {
  if (context) void resumeAudio().catch(() => {});
});
