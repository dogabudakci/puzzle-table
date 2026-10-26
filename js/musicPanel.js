// The music panel: generated moods or the player's own files, play/pause and volume.

import { $ } from './app.js';
import { MOODS, loadSettings, saveSettings, playMood, stopMusic, playingMood, setVolume } from './music.js';
import { withTimeout } from './audio.js';
import { setIcon } from './icons.js';
import { t } from './i18n.js';


const musicPanel = $('music');
const musicBtn = $('music-btn');
const musicToggle = $('music-toggle');
export const musicSettings = loadSettings();
const ownAudio = new Audio();
let ownTracks = []; // { name, url } picked by the player this session
let ownIndex = 0;
let musicSource = 'mood'; // what play resumes: a generated mood or the player's own files
let musicStarting = false;
let musicRequest = 0;

function renderMoods() {
  $('music-moods').replaceChildren(...MOODS.map((mood) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mood';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(musicSource === 'mood' && mood.id === musicSettings.mood));
    const name = document.createElement('strong');
    name.textContent = mood.name;
    const description = document.createElement('span');
    description.textContent = mood.description;
    button.append(name, description);
    button.addEventListener('click', () => {
      musicSettings.mood = mood.id;
      saveSettings(musicSettings);
      playMusic('mood');
    });
    return button;
  }));
}

// On iPhone, music the player chose to play keeps playing with the silent switch on (as in a
// music app); without music, sound effects follow the switch like any game's. (Safari 17+.)
function setAudioSession(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    // Not supported here.
  }
}

function isMusicPlaying() {
  return musicStarting || Boolean(playingMood()) || !ownAudio.paused;
}

async function playMusic(source) {
  const request = ++musicRequest;
  musicSource = source;
  stopMusic();
  ownAudio.pause();
  musicStarting = true;
  setAudioSession('playback');
  try {
    let playback;
    if (source === 'own' && ownTracks.length) {
      ownAudio.src = ownTracks[ownIndex].url;
      ownAudio.volume = musicSettings.volume;
      playback = ownAudio.play();
    } else {
      musicSource = 'mood';
      playback = playMood(musicSettings.mood, musicSettings.volume);
    }
    showMusicState();
    // "Starting…" until it really plays; a start-up that never finishes is treated as a failure.
    await withTimeout(Promise.resolve(playback), 5000, 'Music start-up timed out');
    if (request !== musicRequest) return;
    musicStarting = false;
    showMusicState();
  } catch (error) {
    if (request !== musicRequest) return;
    musicStarting = false;
    stopMusic();
    ownAudio.pause();
    setAudioSession('auto');
    showMusicState();
    $('music-now').textContent = /timed out/.test(error?.message)
      ? t('music.didNotStart')
      : t('music.audioCouldNotStart');
    console.warn('Puzzle music could not start:', error);
  }
}

function pauseMusic() {
  musicRequest++;
  musicStarting = false;
  stopMusic();
  ownAudio.pause();
  setAudioSession('auto');
  showMusicState();
}

function showMusicState() {
  const playing = isMusicPlaying();
  setIcon(musicToggle.querySelector('svg'), playing ? 'i-pause' : 'i-play');
  musicToggle.setAttribute('aria-label', playing ? t('music.pauseMusic') : t('music.playMusic'));
  const what = musicSource === 'own' && ownTracks.length
    ? ownTracks[ownIndex].name
    : MOODS.find((m) => m.id === musicSettings.mood).name;
  $('music-now').textContent = t(musicStarting ? 'music.starting' : playing ? 'music.playingWhat' : 'music.pausedWhat', { a: what });
  musicBtn.classList.toggle('playing', playing);
  renderMoods();
}

export function setMusicPanel(open) {
  musicPanel.hidden = !open;
  musicBtn.setAttribute('aria-pressed', String(open));
}

musicBtn.addEventListener('click', () => setMusicPanel(musicPanel.hidden));
$('music-close').addEventListener('click', () => setMusicPanel(false));
musicToggle.addEventListener('click', () => (isMusicPlaying() ? pauseMusic() : playMusic(musicSource)));

const volumeInput = $('music-volume');
volumeInput.value = musicSettings.volume;
volumeInput.addEventListener('input', () => {
  musicSettings.volume = Number(volumeInput.value);
  setVolume(musicSettings.volume);
  ownAudio.volume = musicSettings.volume;
  saveSettings(musicSettings);
});

$('music-files').addEventListener('change', (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith('audio/'));
  if (!files.length) return;
  for (const track of ownTracks) URL.revokeObjectURL(track.url);
  ownTracks = files.map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
  ownIndex = 0;
  $('music-own-label').textContent = `${t(files.length === 1 ? 'music.fileLoaded' : 'music.filesLoaded', { a: files.length })} · ${t('music.chooseOthers')}`;
  e.target.value = '';
  playMusic('own');
});

// Own files play one after another, then start over.
ownAudio.addEventListener('ended', () => {
  ownIndex = (ownIndex + 1) % ownTracks.length;
  playMusic('own');
});

renderMoods();
showMusicState();


export const isMusicPanelOpen = () => !musicPanel.hidden;

// The music volume from elsewhere (Settings), kept in step with the panel's own slider.
export function setMusicVolume(value) {
  volumeInput.value = value;
  volumeInput.dispatchEvent(new Event('input'));
}
