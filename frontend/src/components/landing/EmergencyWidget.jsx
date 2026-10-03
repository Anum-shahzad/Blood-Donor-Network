import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useOpenRequests, { formatCountdown } from '../../lib/useOpenRequests.js';
import { getUser, donateLinkFor } from '../../auth/session.js';
import { timeAgo } from '../../lib/format.js';

export default function EmergencyWidget() {
  const { open, now } = useOpenRequests();
  const [isOpen, setIsOpen] = useState(false);

  const top = open[0];
  const preview = open.slice(0, 5);

  // Esc closes the modal; lock page scroll while it's open.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setIsOpen(false);
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!top) return null;

  // Real deadlines only: when the requester gave no needed-by time we show how
  // long ago it was posted instead of inventing a countdown.
  const hasDeadline = top.expiresAt !== null;
  const { h, m, sec, compact } = formatCountdown(hasDeadline ? top.expiresAt - now : 0);
  const badgeTime = hasDeadline ? compact : `Posted ${timeAgo(top.createdAt, now)}`;
  const donateTo = donateLinkFor(getUser());

  return (
    <>
      <button type="button" className="lp-emg-badge" onClick={() => setIsOpen(true)} aria-haspopup="dialog">
        <span className="lp-emg-bell" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a6 6 0 0 0-6 6v3.1c0 1.1-.4 2.2-1.2 3L3 16h18l-1.8-1.9c-.8-.8-1.2-1.9-1.2-3V8a6 6 0 0 0-6-6Zm0 20a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Z" /></svg>
        </span>
        <span className="lp-emg-badge-text">
          <strong>Emergency</strong>
          <time aria-label={hasDeadline ? `${compact} remaining` : badgeTime}>{badgeTime}</time>
        </span>
        <span className="lp-emg-badge-arrow" aria-hidden="true">&rarr;</span>
      </button>

      {isOpen && (
        <div className="lp-emg-overlay" role="presentation" onClick={() => setIsOpen(false)}>
          <div
            className="lp-emg-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lp-emg-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="lp-emg-close" aria-label="Close" onClick={() => setIsOpen(false)}>&times;</button>

            <div className="lp-emg-head">
              <span className="lp-emg-pulse" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2-6 4 12 2-6h6" /></svg>
              </span>
              <div className="lp-emg-head-text">
                <h2 id="lp-emg-title">Live Emergency Needs</h2>
                <p>Patients are waiting. Help if you can.</p>
              </div>
              {hasDeadline && (
              <div className="lp-emg-clock">
                <span className="lp-emg-clock-label">
                  <svg viewBox="0 0 24 24" width="13" height="13"><path fill="none" stroke="currentColor" strokeWidth="2" d="M12 7v5l3 3M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" /></svg>
                  Time remaining
                </span>
                <div className="lp-emg-clock-nums">
                  <div><strong>{h}</strong><span>Hours</span></div>
                  <span className="lp-emg-colon">:</span>
                  <div><strong>{m}</strong><span>Minutes</span></div>
                  <span className="lp-emg-colon">:</span>
                  <div><strong>{sec}</strong><span>Seconds</span></div>
                </div>
              </div>
              )}
            </div>

            <ul className="lp-emg-list">
              {preview.map((r) => (
                <li key={r.id} className="lp-emg-row">
                  <span className="lp-emg-type">{r.bloodType}</span>
                  <div className="lp-emg-info">
                    <strong>{r.title}</strong>
                    <span>
                      <svg viewBox="0 0 24 24" width="11" height="11" className="lp-emg-pin"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
                      {r.hospital}{r.city ? `, ${r.city}` : ''}
                    </span>
                  </div>
                  <span className={`lp-emg-tag${r.isUrgent ? ' lp-emg-tag-urgent' : ''}`}>{r.urgencyLabel}</span>
                  {donateTo && (
                    <Link to={donateTo} className="lp-emg-view" onClick={() => setIsOpen(false)}>
                      {getUser() ? 'Respond' : 'I can donate'} <span aria-hidden="true">&rarr;</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            <Link to="/emergency" className="lp-emg-viewall" onClick={() => setIsOpen(false)}>
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2-6 4 12 2-6h6" /></svg>
              View all urgent requests <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
