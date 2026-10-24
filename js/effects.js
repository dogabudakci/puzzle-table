// Sounds (synthesised with Web Audio, no files) and the confetti celebration.

const SOUND_KEY = 'puzzle-sound';
let audio = null;
let soundOn = readSoundSetting();

function readSoundSetting() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundOn() {
  return soundOn;
}

export function setSoundOn(on) {
  soundOn = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable (private mode): the setting just won't be remembered.
  }
}

function context() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

// A short wooden "click", like two cardboard pieces pressing together.
export function playSnap() {
  if (!soundOn) return;
  const ctx = context();
  const length = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800 + Math.random() * 600;
  filter.Q.value = 1.4;
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
}

// A soft, low tap when a piece is put down without joining anything.
export function playDrop() {
  if (!soundOn) return;
  const ctx = context();
  const tap = noise(ctx, 0.04, (t) => Math.pow(1 - t, 6));
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900 + Math.random() * 300;
  const gain = ctx.createGain();
  gain.gain.value = 0.35;
  tap.connect(filter).connect(gain).connect(ctx.destination);
  tap.start();
}

// A burst of filtered noise: the building block for cloth and cardboard sounds.
function noise(ctx, seconds, shape) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * shape(i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

// Opening the pouch: a soft paper sound, like unfolding a paper bag. A gentle papery slide,
// a few quiet crinkles, then the pieces pattering softly onto the table over `spillSeconds`.
export function playPouchOpen(pieceCount, spillSeconds = 1.4) {
  if (!soundOn) return;
  const ctx = context();
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.7; // overall level: one place to make the whole sound louder or softer
  out.connect(ctx.destination);

  // Paper sliding open: airy noise, band-limited so it sounds papery rather than hissy.
  const slide = noise(ctx, 0.55, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.3)), 2));
  const slideHigh = ctx.createBiquadFilter();
  slideHigh.type = 'highpass';
  slideHigh.frequency.value = 1200;
  const slideLow = ctx.createBiquadFilter();
  slideLow.type = 'lowpass';
  slideLow.frequency.value = 5000;
  const slideGain = ctx.createGain();
  slideGain.gain.value = 0.05;
  slide.connect(slideHigh).connect(slideLow).connect(slideGain).connect(out);
  slide.start(now);

  // Crinkles: short, uneven little bursts of paper texture, clustered near the start.
  for (let i = 0; i < 14; i++) {
    const t = now + 0.03 + Math.pow(Math.random(), 1.8) * 0.5;
    const crinkle = noise(ctx, 0.012 + Math.random() * 0.025, (x) => (1 - x) * (0.4 + Math.random() * 0.6));
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200 + Math.random() * 3000;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.03 + Math.random() * 0.05;
    crinkle.connect(filter).connect(gain).connect(out);
    crinkle.start(t);
  }

  // Pieces landing: soft cardboard pats, few and quiet.
  const taps = Math.min(14, Math.max(5, Math.round(pieceCount / 7)));
  for (let i = 0; i < taps; i++) {
    const t = now + 0.45 + Math.pow(Math.random(), 1.4) * spillSeconds;
    const tap = noise(ctx, 0.03, (x) => Math.pow(1 - x, 4));
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + Math.random() * 400;
    const gain = ctx.createGain();
    gain.gain.value = 0.02 + Math.random() * 0.025;
    tap.connect(filter).connect(gain).connect(out);
    tap.start(t);
  }
}

// A rising arpeggio for the finished puzzle.
export function playComplete() {
  if (!soundOn) return;
  const ctx = context();
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.12;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 1.2 : 0.4));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.3);
  });
}

export function confetti(container) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth;
  const h = container.clientHeight;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const colors = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#ffffff'];
  const bits = Array.from({ length: 160 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: h * 0.45,
    vx: (Math.random() - 0.5) * 16,
    vy: -6 - Math.random() * 12,
    size: 6 + Math.random() * 6,
    angle: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const start = performance.now();
  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, Math.max(0, (4000 - elapsed) / 1000));
    for (const b of bits) {
      b.vy += 0.35;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.angle += b.spin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
      ctx.restore();
    }
    if (elapsed < 4000 && canvas.isConnected) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
