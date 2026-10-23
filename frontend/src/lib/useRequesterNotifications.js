import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api/client.js';
import { playAlertSound } from './notifications.js';

const POLL_MS = 15 * 1000;
const MAX_REMEMBERED = 200;

// Notices already announced (sound / system notification) on THIS browser, so a
// poll, a reload or a second tab never repeats them. The server also refuses to
// create the same notice twice; this only guards the announcing.
function loadAnnounced(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`bdn:req-announced:${userId}`) || '[]'));
  } catch {
    return new Set();
  }
}
function saveAnnounced(userId, set) {
  try {
    localStorage.setItem(`bdn:req-announced:${userId}`, JSON.stringify([...set].slice(-MAX_REMEMBERED)));
  } catch { /* storage unavailable: dedupe then only lasts for this page load */ }
}

// Polls the backend for donor-progress and donation-claim notices on this
// requester's own requests. The backend decides what is returned.
export default function useRequesterNotifications({ userId, onNew }) {
  const [items, setItems] = useState([]);
  const announced = useRef(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId || inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await apiGet('/api/notifications/requester/unread');
      const list = data.notifications || [];
      if (!announced.current) announced.current = loadAnnounced(userId);

      const fresh = list.filter((n) => !announced.current.has(n.id));
      if (fresh.length > 0) {
        fresh.forEach((n) => announced.current.add(n.id));
        saveAnnounced(userId, announced.current);
        playAlertSound(); // only plays if the person already enabled alert sound
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          fresh.forEach((n) => {
            try { new Notification(n.title, { body: n.body, icon: '/images/favicon.svg', tag: `bdn-req-${n.id}` }); } catch { /* ignore */ }
          });
        }
        if (onNewRef.current) onNewRef.current(fresh);
      }
      setItems(list);
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
    try { await apiPost('/api/notifications/requester/read', { ids: [id] }); } catch { /* reappears on the next poll if the server missed it */ }
  }, []);

  return { items, dismiss, refresh };
}
