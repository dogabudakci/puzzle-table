// Background music, generated live with Web Audio: no audio files, nothing downloaded,
// and no licences to worry about. Each mood is a small generative piece that never repeats exactly.

import { getAudioContext, resumeAudio } from './audio.js';

const SETTINGS_KEY = 'puzzle-music';
const LOOKAHEAD = 1.2; // seconds of notes scheduled ahead, so background tabs don't stutter

let ctx = null;
let master = null;
let reverb = null;
let noise = null;
let current = null; // { id, stop }
let playRequest = 0;

/* ---------- Settings ---------- */

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { mood: saved?.mood ?? 'piano', volume: saved?.volume ?? 0.6 };
  } catch {
    return { mood: 'piano', volume: 0.6 };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: settings just won't be remembered.
  }
}

/* ---------- Audio plumbing ---------- */

function setup(volume) {
  const shared = getAudioContext();
  if (ctx === shared) return;
  ctx = shared;
  master = ctx.createGain();
  master.gain.value = volume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -16;
  limiter.ratio.value = 4;
  master.connect(limiter).connect(ctx.destination);

  // A soft room reverb from decaying noise.
  reverb = ctx.createConvolver();
  reverb.buffer = impulse(3.5, 2.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  reverb.connect(wet).connect(master);

  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function impulse(seconds, decay) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

export function setVolume(volume) {
  if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}

const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;

// A mood's output: dry into the master, and a share into the reverb.
function createBus(reverbSend) {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, ctx.currentTime);
  bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
  bus.connect(master);
  const send = ctx.createGain();
  send.gain.value = reverbSend;
  bus.connect(send).connect(reverb);
  return bus;
}

// Calls step(time) to schedule events until LOOKAHEAD seconds ahead; step returns the next time.
function schedule(step) {
  let next = ctx.currentTime + 0.1;
  const tick = () => {
    while (next < ctx.currentTime + LOOKAHEAD) next = step(next);
  };
  tick();
  const timer = setInterval(tick, 250);
  return () => clearInterval(timer);
}

function envelope(gain, time, peak, attack, decay) {
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
}

function noiseSource(time, duration) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start(time, Math.random() * 1.5);
  if (duration) src.stop(time + duration);
  return src;
}

/* ---------- Instruments ---------- */

function piano(out, time, midi, velocity = 0.7, length = 2.8) {
  const f = mtof(midi);
  const gain = ctx.createGain();
  envelope(gain, time, 0.16 * velocity, 0.008, length);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(Math.min(9000, f * 7), time);
  tone.frequency.exponentialRampToValueAtTime(f * 1.6, time + length * 0.6);
  tone.connect(gain).connect(out);
  for (const [type, ratio, level] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3, 0.1]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(tone);
    osc.start(time);
    osc.stop(time + length + 0.1);
  }
}

function bell(out, time, midi, velocity = 0.6) {
  const f = mtof(midi);
  for (const [ratio, level, decay] of [[1, 1, 1.8], [2.76, 0.35, 0.9], [5.4, 0.12, 0.4]]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const gain = ctx.createGain();
    envelope(gain, time, 0.09 * velocity * level, 0.004, decay);
    osc.connect(gain).connect(out);
    osc.start(time);
    osc.stop(time + decay + 0.1);
  }
}

function pad(out, time, midis, length) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(500, time);
  filter.frequency.linearRampToValueAtTime(1100, time + length / 2);
  filter.frequency.linearRampToValueAtTime(500, time + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.05, time + 3);
  gain.gain.setValueAtTime(0.05, time + length - 1);
  gain.gain.linearRampToValueAtTime(0.0001, time + length + 3);
  filter.connect(gain).connect(out);
  for (const midi of midis) {
    for (const detune of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + length + 3.2);
    }
  }
}

function keys(out, time, midis, length) {
  // Electric-piano style chord with a gentle tremolo.
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.06, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.025, time + 0.8);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
  const tremolo = ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4.5;
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth).connect(tremolo.gain);
  tremolo.gain.value = 0.75;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1800;
  tone.connect(gain).connect(tremolo).connect(out);
  lfo.start(time);
  lfo.stop(time + length + 0.1);
  for (const midi of midis) {
    for (const [type, ratio, level] of [['sine', 1, 1], ['triangle', 2, 0.15]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(midi) * ratio;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(tone);
      osc.start(time);
      osc.stop(time + length + 0.1);
    }
  }
}

function bass(out, time, midi, length) {
  const osc = ctx.createOscillator();
  osc.frequency.value = mtof(midi);
  const gain = ctx.createGain();
  envelope(gain, time, 0.16, 0.02, length);
  osc.connect(gain).connect(out);
  osc.start(time);
  osc.stop(time + length + 0.1);
}

function kick(out, time) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(110, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
  const gain = ctx.createGain();
  envelope(gain, time, 0.5, 0.004, 0.28);
  osc.connect(gain).connect(out);
  osc.start(time);
  osc.stop(time + 0.35);
}

function snare(out, time) {
  const src = noiseSource(time, 0.25);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1700;
  band.Q.value = 0.8;
  const gain = ctx.createGain();
  envelope(gain, time, 0.16, 0.003, 0.17);
  src.connect(band).connect(gain).connect(out);
}

function hat(out, time, level = 0.05) {
  const src = noiseSource(time, 0.08);
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 7500;
  const gain = ctx.createGain();
  envelope(gain, time, level, 0.002, 0.045);
  src.connect(high).connect(gain).connect(out);
}

// Continuous filtered noise, for rain, wind and record crackle.
function noiseLayer(out, type, frequency, level, q = 0.7) {
  const src = noiseSource(ctx.currentTime);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = level;
  src.connect(filter).connect(gain).connect(out);
  return { src, filter, gain };
}

// Slowly wobbles an AudioParam around its value.
function wobble(param, rate, amount) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.value = amount;
  lfo.connect(depth).connect(param);
  lfo.start();
  return lfo;
}

/* ---------- Moods ---------- */

const C_PENTATONIC = [0, 2, 4, 7, 9];
const scaleNote = (base, scale, step) =>
  base + Math.floor(step / scale.length) * 12 + scale[((step % scale.length) + scale.length) % scale.length];

function softPiano(out) {
  const chords = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]]; // C, Am, F, G
  const beat = 0.8;
  let beatIndex = 0;
  let step = 7;
  return schedule((time) => {
    const chord = chords[Math.floor(beatIndex / 8) % chords.length];
    const human = Math.random() * 0.03;
    if (beatIndex % 8 === 0) {
      piano(out, time, chord[0], 0.55, 4);
      piano(out, time + 0.02, chord[0] + 12, 0.35, 4);
    }
    if (chance(0.6)) {
      step = Math.max(3, Math.min(13, step + pick([-2, -1, -1, 1, 1, 2])));
      piano(out, time + human, scaleNote(60, C_PENTATONIC, step), 0.5 + Math.random() * 0.35);
    }
    if (chance(0.22)) piano(out, time + beat / 2 + human, pick(chord) + 12, 0.35);
    beatIndex++;
    return time + beat;
  });
}

function warmAmbient(out) {
  const chords = [[48, 55, 59, 64], [45, 52, 55, 60, 64], [41, 48, 52, 57], [40, 47, 50, 55]];
  const length = 10;
  let index = 0;
  const stopPads = schedule((time) => {
    pad(out, time, chords[index++ % chords.length], length);
    return time + length;
  });
  const stopTwinkles = schedule((time) => {
    if (chance(0.7)) bell(out, time, scaleNote(72, C_PENTATONIC, Math.floor(Math.random() * 8)), 0.35);
    return time + 1.5 + Math.random() * 3;
  });
  return () => { stopPads(); stopTwinkles(); };
}

function lofi(out) {
  const bpm = 72;
  const sixteenth = 60 / bpm / 4;
  // Dm9, G13, Cmaj9, Am9
  const chords = [[50, 53, 57, 60, 64], [43, 53, 57, 59, 64], [48, 52, 55, 59, 62], [45, 48, 52, 55, 59]];
  const roots = [38, 31, 36, 33];
  const crackle = noiseLayer(out, 'highpass', 5000, 0.006);
  let stepIndex = 0;
  const stop = schedule((time) => {
    const bar = Math.floor(stepIndex / 16) % chords.length;
    const s = stepIndex % 16;
    const swing = s % 4 === 2 ? sixteenth * 0.33 : 0;
    const t = time + swing;
    if (s === 0) {
      keys(out, t, chords[bar], sixteenth * 14);
      bass(out, t, roots[bar], sixteenth * 6);
    }
    if (s === 10 && chance(0.5)) keys(out, t, chords[bar].slice(1), sixteenth * 5);
    if (s === 8) bass(out, t, roots[bar] + (chance(0.5) ? 7 : 12), sixteenth * 4);
    if (s === 0 || s === 7 || (s === 10 && chance(0.6))) kick(out, t);
    if (s === 4 || s === 12) snare(out, t);
    if (s % 2 === 0) hat(out, t, s % 4 === 0 ? 0.05 : 0.03);
    if (chance(0.04)) hat(out, time, 0.02); // dust on the record
    stepIndex++;
    return time + sixteenth;
  });
  return () => { stop(); crackle.src.stop(); };
}

function musicBox(out) {
  const eighth = 60 / 92 / 2;
  let step = 5;
  let index = 0;
  return schedule((time) => {
    if (index % 16 === 0) bell(out, time, 48, 0.5);
    if (!(index % 8 === 7 && chance(0.6))) {
      step = Math.max(0, Math.min(11, step + pick([-1, -1, 1, 1, 2, -2, 0])));
      bell(out, time, scaleNote(72, C_PENTATONIC, step), 0.55 + Math.random() * 0.3);
    }
    index++;
    return time + eighth;
  });
}

function rain(out) {
  const body = noiseLayer(out, 'lowpass', 1400, 0.22);
  const hiss = noiseLayer(out, 'highpass', 4000, 0.05);
  const lfo = wobble(body.gain.gain, 0.07, 0.06);
  const stop = schedule((time) => {
    const src = noiseSource(time, 0.05);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2000 + Math.random() * 4000;
    band.Q.value = 12;
    const gain = ctx.createGain();
    envelope(gain, time, 0.04 + Math.random() * 0.06, 0.002, 0.03);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    src.connect(band).connect(gain).connect(pan).connect(out);
    return time + 0.02 + Math.random() * 0.12;
  });
  return () => { stop(); body.src.stop(); hiss.src.stop(); lfo.stop(); };
}

function forest(out) {
  const wind = noiseLayer(out, 'bandpass', 450, 0.18, 0.6);
  const windSweep = wobble(wind.filter.frequency, 0.05, 250);
  const windSwell = wobble(wind.gain.gain, 0.08, 0.08);
  const leaves = noiseLayer(out, 'highpass', 3500, 0.012);
  const stop = schedule((time) => {
    // A bird call: a few quick chirps sweeping in pitch.
    const base = 2200 + Math.random() * 2200;
    const chirps = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(out);
    for (let i = 0; i < chirps; i++) {
      const t = time + i * (0.09 + Math.random() * 0.06);
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.2), t);
      osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06);
      const gain = ctx.createGain();
      envelope(gain, t, 0.035, 0.01, 0.07);
      osc.connect(gain).connect(pan);
      osc.start(t);
      osc.stop(t + 0.1);
    }
    return time + 1.2 + Math.random() * 4;
  });
  return () => { stop(); wind.src.stop(); leaves.src.stop(); windSweep.stop(); windSwell.stop(); };
}

export const MOODS = [
  { id: 'piano', name: 'Soft piano', description: 'Gentle notes, slow chords', start: softPiano, reverb: 0.6 },
  { id: 'ambient', name: 'Warm ambient', description: 'Slow pads and soft bells', start: warmAmbient, reverb: 0.8 },
  { id: 'lofi', name: 'Lo-fi', description: 'Mellow beats and chords', start: lofi, reverb: 0.25 },
  { id: 'musicbox', name: 'Music box', description: 'A tiny lullaby', start: musicBox, reverb: 0.7 },
  { id: 'rain', name: 'Rain', description: 'Soft rainfall', start: rain, reverb: 0.15 },
  { id: 'forest', name: 'Forest', description: 'Breeze and birdsong', start: forest, reverb: 0.35 },
];

/* ---------- Play / stop ---------- */

export async function playMood(id, volume) {
  stopMusic();
  const request = playRequest;
  // Resume within the click handler, then schedule notes only once audio runs.
  const ready = resumeAudio();
  await ready;
  if (request !== playRequest) return;
  setup(volume);
  setVolume(volume);
  const mood = MOODS.find((m) => m.id === id) ?? MOODS[0];
  const bus = createBus(mood.reverb);
  const stopMood = mood.start(bus);
  current = {
    id: mood.id,
    stop: () => {
      stopMood();
      // Fade out, then cut everything this mood scheduled.
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + 1);
      setTimeout(() => bus.disconnect(), 1100);
    },
  };
}

export function stopMusic() {
  playRequest++;
  current?.stop();
  current = null;
}

export function playingMood() {
  return current?.id ?? null;
}
