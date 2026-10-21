// Thin wrapper over the standard `web-push` library. VAPID keys come ONLY from
// backend environment variables; the private key never leaves the server.
//
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com or https://your-site)
import webpush from 'web-push';

let configured = null; // null = not tried, true/false after first call

export function isPushConfigured() {
  if (configured !== null) return configured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (err) {
    console.error('Web Push disabled, invalid VAPID configuration:', err.message);
    configured = false;
  }
  return configured;
}

export function getPublicKey() {
  return isPushConfigured() ? process.env.VAPID_PUBLIC_KEY : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends one message to one subscription. Retries once for transient failures
// (network error, 429, 5xx). Returns:
//   { outcome: 'accepted', attempts, httpStatus }   push service accepted it (NOT proof it was seen)
//   { outcome: 'expired',  attempts, httpStatus }   404/410, the subscription is gone for good
//   { outcome: 'failed',   attempts, httpStatus, error }
export async function sendPush(subscription, payload, { ttlSeconds = 3600, urgency = 'high' } = {}) {
  let attempts = 0;
  let last = null;
  while (attempts < 2) {
    attempts += 1;
    try {
      const res = await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { TTL: ttlSeconds, urgency, timeout: 8000 }
      );
      return { outcome: 'accepted', attempts, httpStatus: res?.statusCode ?? 201 };
    } catch (err) {
      const status = err?.statusCode ?? null;
      if (status === 404 || status === 410) return { outcome: 'expired', attempts, httpStatus: status };
      last = { outcome: 'failed', attempts, httpStatus: status, error: String(err?.body || err?.message || 'send failed').slice(0, 250) };
      const transient = status === null || status === 429 || status >= 500;
      if (!transient) break; // 400/401/403/413: retrying cannot help
      if (attempts < 2) await sleep(700);
    }
  }
  return last;
}
