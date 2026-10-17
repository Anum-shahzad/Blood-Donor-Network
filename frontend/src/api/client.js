import { clearSession } from '../auth/session.js';

// In development this falls back to the local backend. In a production build
// VITE_API_URL MUST be set (Vercel → Project → Settings → Environment
// Variables), otherwise the site has no API to talk to.
const BASE_URL = (
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '')
).replace(/\/+$/, '');

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// body may be a plain object (sent as JSON) or a FormData (multipart upload;
// the browser sets the Content-Type with its boundary). { blob: true } returns
// the response as a Blob, used for private documents that need the bearer token.
async function request(method, path, body, { blob = false } = {}) {
  if (!BASE_URL) {
    throw new Error('The app is not connected to a server (VITE_API_URL is not set).');
  }

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects when the request never got an answer at all.
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  if (blob && res.ok) return res.blob();

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // An expired/invalid token on a protected call: drop the session and send
    // the person to log in again. Login/signup 401s ("wrong password") must
    // NOT trigger this, hence the /api/auth/ exclusion.
    if (res.status === 401 && localStorage.getItem('token') && !path.startsWith('/api/auth/')) {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?expired=1');
      }
    }
    // The server re-checks the account on every request, so a suspension takes
    // effect immediately. Drop the stale session and show the login page with
    // the suspension notice. Login attempts (/api/auth/) just show the error.
    if (res.status === 403 && data.code === 'ACCOUNT_SUSPENDED' && !path.startsWith('/api/auth/')) {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?suspended=1');
      }
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

export const apiGet = (path) => request('GET', path);
export const apiPost = (path, body = {}) => request('POST', path, body);
export const apiPut = (path, body = {}) => request('PUT', path, body);
export const apiPatch = (path, body = {}) => request('PATCH', path, body);
export const apiUpload = (path, formData) => request('POST', path, formData);
export const apiGetBlob = (path) => request('GET', path, undefined, { blob: true });
