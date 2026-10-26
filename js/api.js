import { t, serverMessage } from './i18n.js';
// Talking to the app's own server. The session is an HttpOnly cookie the browser sends by
// itself; requests are JSON, which the server requires (part of its cross-site protection).
//
// A failed request throws an Error with the message to show (in the player's language) and
// `code`: the server's code for what went wrong ('gameClosed', 'notSolvedYet'…), or 'offline'
// when the server couldn't be reached. Code that reacts to an error checks the code, never the
// message, which depends on the language.

function apiError(message, code, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export async function api(path, body, { keepalive = false } = {}) {
  const options = body === undefined
    ? { credentials: 'same-origin' }
    : {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    };
  let response;
  try {
    response = await fetch(`/api/${path}`, options);
  } catch {
    throw apiError(t('account.reachServerCheckConnection'), 'offline');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw apiError(serverMessage(data, t('account.somethingWentWrongPlease')), data.code ?? 'unknown', response.status);
  }
  return data;
}

export async function apiBlob(path) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Not found');
  return response.blob();
}

// A Blob as base64 (without the "data:...;base64," prefix), for sending pictures as JSON.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
