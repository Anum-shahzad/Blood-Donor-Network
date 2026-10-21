import '../styles/notifications.css';
import { HeartIcon, XIcon, ClockIcon } from './icons.jsx';
import { formatDateTime } from '../lib/format.js';

// Popup stack for unread urgent alerts. One card per notification id; a card
// stays until the donor dismisses it or acts on it (or the server stops
// returning it because the request closed / the donor answered it).
export default function NotificationPopups({
  items,
  soundState,
  onEnableSound,
  onView,
  onAccept,
  onDismiss,
  acceptingRequestId,
  canAccept,
  identityRequired = false,
  onVerify,
}) {
  if (!items || items.length === 0) return null;
  const showSoundHint = soundState === 'off' || soundState === 'blocked';

  return (
    <div className="alert-popups" role="region" aria-label="Urgent blood alerts" aria-live="assertive">
      {showSoundHint && (
        <div className="alert-popup-sound">
          <span>{soundState === 'blocked' ? 'Your browser muted the alert sound.' : 'Alert sound is off.'}</span>
          <button type="button" onClick={onEnableSound}>Enable Alert Sound</button>
        </div>
      )}
      {items.map((n) => (
        <div key={n.id} className={`alert-popup${n.urgency === 'critical' ? ' alert-popup--critical' : ''}`} role="alert">
          <div className="alert-popup-head">
            <div className="alert-popup-group">{n.blood_group}</div>
            <div className="alert-popup-body">
              <strong>{n.title}</strong>
              <span>{n.hospital_name}, {n.city}</span>
              <span>
                {n.units_open} of {n.units_needed} unit{n.units_needed === 1 ? '' : 's'} still open
                {n.distance_km != null ? ` · ${n.distance_km} km away` : ''}
              </span>
              {n.required_by && (
                <span><ClockIcon size={11} /> Needed by {formatDateTime(n.required_by)}</span>
              )}
            </div>
            <button type="button" className="alert-popup-close" onClick={() => onDismiss(n)} aria-label="Dismiss alert">
              <XIcon size={16} />
            </button>
          </div>
          <div className="alert-popup-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onAccept(n)}
              disabled={!canAccept || acceptingRequestId === n.request_id}
            >
              <HeartIcon size={14} /> {acceptingRequestId === n.request_id ? 'Accepting...' : 'Accept'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onView(n)}>
              View Request
            </button>
          </div>
          {identityRequired && (
            <p style={{ margin: '0.55rem 0 0', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
              Identity verification (Level 3) is required before you can accept a request.{' '}
              <button
                type="button"
                onClick={onVerify}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                Go to Verification
              </button>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
