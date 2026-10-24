// Talking to the app's own server. The session is an HttpOnly cookie the browser sends by
// itself; requests are JSON, which the server requires (part of its cross-site protection).

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
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
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
