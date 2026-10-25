// The Settings window (language, sound, music volume, table, tips) and the tips for new players.

import { $, app, state, screens } from './app.js';
import { isSoundOn, setSoundOn, soundVolume, setSoundVolume, testSound } from './effects.js';
import { showGuide, guideSeen, resetGuide } from './guide.js';
import { LANGUAGES, currentLanguage, setLanguage } from './i18n.js';
import { createTablePicker } from './textures.js';
import { musicSettings, setMusicVolume } from './musicPanel.js';


let closeGuide = null;
const settingsDialog = $('settings-dialog');

function openSettings() {
  $('set-sound').checked = isSoundOn();
  $('set-sound-volume').value = soundVolume();
  $('set-music-volume').value = musicSettings.volume;
  $('settings-tables').replaceChildren(createTablePicker(state.table, app.pickTable));
  $('set-language').value = currentLanguage();
  settingsDialog.showModal();
}
$('settings-btn').addEventListener('click', openSettings);
$('game-settings-btn').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (e) => { if (e.target === settingsDialog) settingsDialog.close(); });
$('set-sound').addEventListener('change', (e) => {
  setSoundOn(e.target.checked);
  app.showSound();
});
$('set-language').replaceChildren(...Object.entries(LANGUAGES).map(([code, name]) => new Option(name, code)));
$('set-language').addEventListener('change', (e) => setLanguage(e.target.value));
$('set-sound-volume').addEventListener('input', (e) => setSoundVolume(Number(e.target.value)));
$('set-music-volume').addEventListener('input', (e) => setMusicVolume(e.target.value));
$('set-test-sound').addEventListener('click', async () => {
  const result = $('sound-test-result');
  result.textContent = 'Playing a short chime…';
  const outcome = await testSound();
  result.textContent = outcome.ok
    ? 'You should hear two soft notes. If not, check the device volume and silent switch.'
    : outcome.reason === 'blocked'
      ? `This browser is holding sound back (${outcome.state}). Tap the page once, then try again.`
      : 'This browser can’t play sound here.';
});

$('set-guide').addEventListener('click', () => {
  resetGuide();
  settingsDialog.close();
  if (!screens.game.hidden && state.game) {
    showTips();
  } else {
    app.social.notice('The tips will show in your next puzzle.');
  }
});
$('help-btn').addEventListener('click', showTips);

export function showTips() {
  closeTips();
  closeGuide = showGuide(screens.game);
}

// The first game: the tips, unless they were seen before.
export function showTipsOnce() {
  if (!guideSeen()) showTips();
}

export function closeTips() {
  closeGuide?.();
  closeGuide = null;
}

