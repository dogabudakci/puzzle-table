// One audio context for effects and music, unlocked by a real user gesture.
let context = null;

export function getAudioContext() {
  if (!context || context.state === 'closed') {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Audio playback is unavailable in this browser.');
    context = new AudioContext();
  }
  return context;
}

export async function resumeAudio() {
  const ctx = getAudioContext();
  // Safari can report "interrupted" as well as "suspended".
  if (ctx.state !== 'running') await ctx.resume();
  if (ctx.state !== 'running') throw new Error('Audio playback has not resumed.');
  return ctx;
}

function unlockAudio() {
  // A blocked attempt is retried on the next gesture. Call resume synchronously
  // inside the event, before a drag or an asynchronous action loses activation.
  void resumeAudio().catch(() => {});
}

for (const event of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
  document.addEventListener(event, unlockAudio, { capture: true, passive: true });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && context) unlockAudio();
});
window.addEventListener('pageshow', () => {
  if (context) unlockAudio();
});
