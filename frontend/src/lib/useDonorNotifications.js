import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api/client.js';
import { playAlertSound, showSystemNotification, soundState } from './notifications.js';

const POLL_MS = 15 * 1000;
const MAX_REMEMBERED = 200;

// Alerts already announced (sound / system notification) on THIS browser, so a
// poll, a page reload or a second tab never repeats them.
function loadAnnounced(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`bdn:announced:${userId}`) || '[]'));
  } catch {
    return new Set();
  }
}
function saveAnnounced(userId, set) {
  try {
    localStorage.setItem(`bdn:announced:${userId}`, JSON.stringify([...set].slice(-MAX_REMEMBERED)));
  } catch { /* storage unavailable: dedupe then only lasts for this page load */ }
}

// Polls the backend for unread urgent alerts addressed to this donor.
// The backend decides what is eligible; this hook only displays what it returns.
export default function useDonorNotifications({ userId, onNew }) {
  const [items, setItems] = useState([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const announced = useRef(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId || inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await apiGet('/api/notifications/unread');
      const list = data.notifications || [];
      if (!announced.current) announced.current = loadAnnounced(userId);

      const fresh = list.filter((n) => !announced.current.has(n.id));
      if (fresh.length > 0) {
        fresh.forEach((n) => announced.current.add(n.id));
        saveAnnounced(userId, announced.current);

        // One sound per batch, only for alerts the donor allowed in-app.
        if (fresh.some((n) => n.show_popup)) {
          const played = playAlertSound();
          setSoundBlocked(!played);
        }
        // System notification only when the tab is not in front of the donor.
        if (document.hidden || !document.hasFocus()) {
          fresh.filter((n) => n.show_system_notification).forEach((n) => showSystemNotification(n));
        }
        if (onNewRef.current) onNewRef.current(fresh);
      }
      setItems(list.filter((n) => n.show_popup));
    } catch {
      /* transient network/server error: try again on the next poll */
    } finally {
      inFlight.current = false;
    }
  }, [userId]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  const dismiss = useCallback(async (id) => {
    setItems((list) => list.filter((n) => n.id !== id));
    try { await apiPost('/api/notifications/read', { ids: [id] }); } catch { /* it will reappear on the next poll if the server missed it */ }
  }, []);

  const acknowledge = useCallback(async (id) => {
    setItems((list) => list.filter((n) => n.id !== id));
    try { await apiPost(`/api/notifications/${id}/acknowledge`, {}); } catch { /* same as above */ }
  }, []);

  return { items, dismiss, acknowledge, refresh, soundBlocked, soundState: soundState() };
}
