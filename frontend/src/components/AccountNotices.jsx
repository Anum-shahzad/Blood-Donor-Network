import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.js';
import { formatDateTime } from '../lib/format.js';

const POLL_MS = 30 * 1000;

// Moderation notices for donors and requesters: warnings, suspension and
// reinstatement notices, and the outcome of a report they filed. They come from
// the existing notifications table (type 'account_notice') and stay until the
// person dismisses them.
export default function AccountNotices() {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet('/api/notifications/account/unread');
      setItems(data.notifications || []);
    } catch {
      /* transient error: try again on the next poll */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function dismiss(id) {
    setItems((list) => list.filter((n) => n.id !== id));
    try {
      await apiPost('/api/notifications/account/read', { ids: [id] });
    } catch {
      /* reappears on the next poll if the server missed it */
    }
  }

  if (items.length === 0) return null;

  return (
    <div role="region" aria-label="Account notices" style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}>
      {items.map((n) => (
        <div
          key={n.id}
          role="alert"
          style={{
            background: 'var(--amber-bg)',
            color: 'var(--ink)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 0.9rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block' }}>{n.title}</strong>
            <span style={{ display: 'block', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{n.body}</span>
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-muted)', marginTop: '0.25rem' }}>
              {formatDateTime(n.created_at)}
            </span>
          </div>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => dismiss(n.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
