// The app in English, Turkish or German.
//
// Every text has a stable key (see messages.js). The page marks its texts with
// data-i18n="key", and attributes with data-i18n-attr="title:key;aria-label:key"; the code asks
// for texts with t('key', { a: …, b: … }). A text missing in a language falls back to English.
//
// The language is the one picked in Settings, or the browser's if it's one of these.

import { MESSAGES } from './messages.js';

const LANGUAGE_KEY = 'puzzle-language';
export const LANGUAGES = { en: 'English', tr: 'Türkçe', de: 'Deutsch' };
const COLUMN = { en: 0, tr: 1, de: 2 };

export function currentLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && LANGUAGES[saved]) return saved;
  } catch {
    // Storage unavailable: use the browser's language.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (LANGUAGES[code]) return code;
  }
  return 'en';
}

const language = currentLanguage();

// Saves the choice and reloads, so everything on the page is in the new language.
export function setLanguage(code) {
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    // Storage unavailable: the choice lasts until the page is reloaded.
  }
  location.reload();
}

// The text for `key` in the current language, with its blanks ({a}, {b}…) filled in.
export function t(key, values = {}) {
  const row = MESSAGES[key];
  if (!row) {
    console.warn(`No text for "${key}"`);
    return key;
  }
  const text = row[COLUMN[language]] ?? row[0];
  return text.replace(/\{(\w)\}/g, (blank, name) => (name in values ? String(values[name]) : blank));
}

// A library photo's name in the current language (by its id), or the name it was given.
export function photoName(photo) {
  return MESSAGES[`photo.${photo.id}`] ? t(`photo.${photo.id}`) : photo.name;
}

// A message from the server, by its code; the server's own English if there's no translation.
export function serverMessage(data, fallback) {
  if (data?.code && MESSAGES[`server.${data.code}`]) return t(`server.${data.code}`, data.values ?? {});
  return data?.error || fallback;
}

// Puts the current language's texts into everything marked with data-i18n under `root`.
export function translatePage(root = document) {
  document.documentElement.lang = language;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [name, key] = pair.split(':');
      el.setAttribute(name, t(key));
    }
  }
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = title.textContent;
}

// The page is written in English; another language is put in as soon as this file loads, before
// any other part of the app fills in texts of its own.
if (language !== 'en') translatePage();
