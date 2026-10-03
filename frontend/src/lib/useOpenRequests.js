import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.js';

// Public, no-login endpoint: only admin-verified, still-open requests, with no
// personal details. Real data only — if the server can't be reached the UI
// shows that honestly instead of inventing requests.
export const REQUESTS_ENDPOINT = '/api/public/emergencies';
export const HOUR = 3600000;
const REFRESH_MS = 60 * 1000;

const URGENCY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const URGENCY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function normalize(data) {
  const rows = Array.isArray(data?.requests) ? data.requests : [];
  return rows
    .map((r) => {
      const deadline = r.required_by ? new Date(r.required_by).getTime() : NaN;
      const created = new Date(r.created_at).getTime();
      const urgency = URGENCY_RANK[r.urgency] !== undefined ? r.urgency : 'medium';
      const units = Number(r.units_needed) || 1;
      return {
        id: r.id,
        bloodType: r.blood_group,
        units,
        title: `${units} unit${units > 1 ? 's' : ''} of ${r.blood_group} needed`,
        hospital: r.hospital_name,
        city: r.city || '',
        urgency,
        urgencyLabel: URGENCY_LABEL[urgency],
        isUrgent: urgency === 'critical' || urgency === 'high',
        // null when the requester gave no needed-by time: we never invent a deadline.
        expiresAt: Number.isFinite(deadline) ? deadline : null,
        createdAt: Number.isFinite(created) ? created : null,
      };
    })
    .filter((r) => r.id && r.bloodType);
}

function byPriority(a, b) {
  if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) {
    return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  }
  return (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity);
}

// Loads open requests, refreshes every minute, and ticks every second so any
// component using this hook gets a live countdown for free.
export default function useOpenRequests() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    function load() {
      apiGet(REQUESTS_ENDPOINT)
        .then((data) => {
          if (!alive) return;
          setItems(normalize(data));
          setError('');
        })
        .catch((err) => {
          // Keep whatever we already showed; just flag the failed refresh.
          if (alive) setError(err.message);
        });
    }
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const open = (items || [])
    .filter((r) => r.expiresAt === null || r.expiresAt > now)
    .sort(byPriority);

  return { open, loading: items === null && !error, error, now };
}

export function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return { h, m, sec, compact: `${h}:${m}:${sec}` };
}
