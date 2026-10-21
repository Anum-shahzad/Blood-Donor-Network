// Push subscription endpoints are URLs chosen by the client, and the server
// later POSTs to them. Without a host allowlist that would be an SSRF hole
// (a donor could make the server call internal addresses). Only the real
// browser push services are accepted.
//
// Extra hosts (suffix match) can be added with PUSH_ENDPOINT_ALLOWED_HOSTS.
const BUILT_IN = [
  'fcm.googleapis.com',            // Chrome, Edge, Brave, Opera, Samsung Internet
  'push.services.mozilla.com',     // Firefox (updates.push.services.mozilla.com, ...)
  'push.apple.com',                // Safari / iOS / macOS (web.push.apple.com)
  'notify.windows.com',            // legacy Edge / WNS
];

function allowedSuffixes() {
  const extra = (process.env.PUSH_ENDPOINT_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...BUILT_IN, ...extra];
}

export function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return allowedSuffixes().some((s) => host === s || host.endsWith(`.${s}`));
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

// Returns { ok, endpoint, p256dh, auth } or { ok: false, error }.
export function validateSubscription(body) {
  const sub = body?.subscription ?? body;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!isAllowedPushEndpoint(endpoint)) return { ok: false, error: 'Unsupported push endpoint' };
  if (typeof p256dh !== 'string' || !B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) {
    return { ok: false, error: 'Invalid push key' };
  }
  if (typeof auth !== 'string' || !B64URL.test(auth) || auth.length < 20 || auth.length > 30) {
    return { ok: false, error: 'Invalid push key' };
  }
  return { ok: true, endpoint, p256dh, auth };
}
