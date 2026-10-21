// Browser-side helpers for alert sound, system notifications and Web Push.
// Everything here uses free, built-in browser APIs.
import { apiGet, apiPost } from '../api/client.js';

const SOUND_KEY = 'bdn:alert-sound';
const ASKED_KEY = 'bdn:notif-asked';

// ---------------------------------------------------------------- sound ----
// The alert tone is synthesised with the Web Audio API, so there is no audio
// file to host. Browsers keep audio locked until the person interacts with the
// page, so enableSound() must be called from a click handler.
let audioCtx = null;

export function soundPreference() {
  try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}

// 'unsupported' | 'off' | 'blocked' (wanted but locked by the browser) | 'on'
export function soundState() {
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return 'unsupported';
  if (!soundPreference()) return 'off';
  return audioCtx && audioCtx.state === 'running' ? 'on' : 'blocked';
}

export async function enableSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return 'unsupported';
  if (!audioCtx) audioCtx = new Ctx();
  try { await audioCtx.resume(); } catch { /* handled by the state check below */ }
  try { localStorage.setItem(SOUND_KEY, '1'); } catch { /* preference just won't persist */ }
  return soundState();
}

export function disableSound() {
  try { localStorage.setItem(SOUND_KEY, '0'); } catch { /* ignore */ }
}

// Two-tone alert. Returns false when the browser still has audio locked.
export function playAlertSound() {
  if (soundState() !== 'on') return false;
  const now = audioCtx.currentTime;
  [[880, 0], [660, 0.22], [880, 0.44]].forEach(([freq, offset]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.22);
  });
  return true;
}

// ------------------------------------------------- system notifications ----
// 'unsupported' | 'default' (not asked yet) | 'granted' | 'denied'
export function browserNotificationState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// Only call this from a click on an "Enable" button. Never asks again once denied.
export async function requestBrowserPermission() {
  if (browserNotificationState() !== 'default') return browserNotificationState();
  try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* ignore */ }
  try {
    return await Notification.requestPermission();
  } catch {
    return browserNotificationState();
  }
}

// Shows a native notification for an in-app alert. Goes through the service
// worker when available (required on Android Chrome), with the same tag the
// push uses so the same alert never appears twice on one device.
export async function showSystemNotification(n, { onClick } = {}) {
  if (browserNotificationState() !== 'granted') return false;
  const options = {
    body: `${n.hospital_name}, ${n.city} · ${n.units_open} unit${n.units_open === 1 ? '' : 's'} open`,
    icon: '/images/favicon.svg',
    tag: `bdn-alert-${n.id}`,
    requireInteraction: n.urgency === 'critical' || n.urgency === 'high',
    data: { url: n.url, notificationId: n.id },
  };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) {
      await reg.showNotification(n.title, options);
      return true;
    }
    const note = new Notification(n.title, options);
    note.onclick = () => { window.focus(); note.close(); if (onClick) onClick(n); };
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------- web push ------
export function pushSupport() {
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' };
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasApis) return { supported: true };
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (isIos && !standalone) return { supported: false, reason: 'ios-needs-home-screen' };
  return { supported: false, reason: 'unsupported' };
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function getCurrentSubscription() {
  if (!pushSupport().supported) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export const getPushConfig = () => apiGet('/api/notifications/push/config');

// Subscribes this browser and saves the subscription on the server. Must be
// triggered by a click (it asks for notification permission if needed).
export async function enablePush() {
  const support = pushSupport();
  if (!support.supported) throw new Error('Push notifications are not supported in this browser.');
  const config = await getPushConfig();
  if (!config.configured || !config.public_key) {
    throw new Error('Push notifications are not set up on the server yet.');
  }
  const permission = await requestBrowserPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
      : 'Notification permission was not granted.');
  }
  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.public_key),
    });
  }
  // The server confirms; only then do we call it enabled.
  await apiPost('/api/notifications/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

// Removes this device on the server and in the browser. Best effort: used by
// the settings switch and on logout (so a signed-out device stops receiving).
export async function disablePush() {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  try { await apiPost('/api/notifications/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* server cleanup is also done on 404/410 */ }
  try { await sub.unsubscribe(); } catch { /* already gone */ }
}
