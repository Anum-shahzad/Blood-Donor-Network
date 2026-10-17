import { apiGetBlob } from '../api/client.js';

// Private documents have no public URL: the API only serves them to a request
// carrying the bearer token. So the file is fetched with that token as a Blob
// and shown from a short-lived local object URL.
//
// The tab is opened first, synchronously, so the browser's popup blocker
// treats it as part of the click; it is closed again if the fetch fails.
//
// `scope` picks which private store the key belongs to: identity / donation
// documents (default) or request evidence.
const DOCUMENT_PATHS = {
  verification: '/api/verification/documents/',
  'request-evidence': '/api/request-evidence/documents/',
};

export async function openPrivateDocument(key, scope = 'verification') {
  const tab = window.open('', '_blank');
  try {
    const base = DOCUMENT_PATHS[scope] || DOCUMENT_PATHS.verification;
    const blob = await apiGetBlob(`${base}${encodeURIComponent(key)}`);
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (err) {
    if (tab) tab.close();
    throw err;
  }
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
