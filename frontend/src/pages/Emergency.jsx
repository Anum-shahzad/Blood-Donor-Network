import { useState } from 'react';
import { Link } from 'react-router-dom';
import useOpenRequests, { formatCountdown } from '../lib/useOpenRequests.js';
import { getUser, donateLinkFor } from '../auth/session.js';
import ThemeToggle from '../components/landing/ThemeToggle.jsx';
import useTheme from '../lib/useTheme.js';
import { timeAgo } from '../lib/format.js';
import '../styles/landing.css';

export default function Emergency() {
  const { open, loading, error, now } = useOpenRequests();
  const donateTo = donateLinkFor(getUser());
  const { theme, toggle: toggleTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

  return (
    <div className="lp-page lp-emergency-page" data-theme={theme}>
      <header className={`lp-site-header${navOpen ? ' lp-nav-open' : ''}`}>
        <div className="lp-container lp-header-inner">
          <Link to="/" className="lp-logo" aria-label="Blood Donor Network home">
            <span className="lp-logo-mark" aria-hidden="true">
              <svg width="22" height="26" viewBox="0 0 22 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 1C11 1 1 12.5 1 18C1 22.4183 5.47715 26 11 26C16.5228 26 21 22.4183 21 18C21 12.5 11 1 11 1Z" fill="var(--lp-logo-drop)" />
              </svg>
            </span>
            Blood Donor Network
          </Link>
          <nav className="lp-main-nav" aria-label="Primary" id="lp-main-nav">
            <Link to="/#how-it-works" onClick={closeNav}>How it works</Link>
            <Link to="/#compatibility" onClick={closeNav}>Blood types</Link>
            <Link to="/#donors" onClick={closeNav}>For donors</Link>
            <Link to="/#patients" onClick={closeNav}>For patients</Link>
            <Link to="/#safety" onClick={closeNav}>Safety</Link>
            <Link to="/#about" onClick={closeNav}>About</Link>
            <Link to="/emergency" className="lp-nav-emergency lp-nav-current" aria-current="page" onClick={closeNav}>Emergency</Link>
          </nav>
          <div className="lp-header-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <Link to="/signup" className="lp-btn lp-btn-primary lp-btn-sm">Find a donor</Link>
            <button
              className="lp-nav-toggle"
              aria-expanded={navOpen}
              aria-controls="lp-main-nav"
              aria-label="Toggle menu"
              onClick={() => setNavOpen((v) => !v)}
              type="button"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
          </div>
        </div>
      </header>

      <main className="lp-section">
        <div className="lp-container">
          <p className="lp-eyebrow">Emergency</p>
          <h1>All urgent requests</h1>
          <p className="lp-emg-page-sub">
            Every open request currently waiting on a donor, most urgent first.
          </p>

          {loading && <p>Loading open requests…</p>}
          {error && open.length === 0 && (
            <p role="alert">We couldn&rsquo;t load open requests right now ({error}). Please try again in a moment.</p>
          )}
          {error && open.length > 0 && (
            <p role="status">Couldn&rsquo;t refresh just now — showing the last list we loaded.</p>
          )}
          {!loading && !error && open.length === 0 && (
            <p>No open emergencies right now. Thank you to every donor keeping it that way.</p>
          )}

          <ul className="lp-emg-fulllist">
            {open.map((r) => {
              const hasDeadline = r.expiresAt !== null;
              const { compact } = formatCountdown(hasDeadline ? r.expiresAt - now : 0);
              const timeText = hasDeadline ? compact : `Posted ${timeAgo(r.createdAt, now)}`;
              return (
                <li key={r.id} className={`lp-emg-fullrow${r.isUrgent ? ' lp-emg-fullrow-urgent' : ''}`}>
                  <span className="lp-emg-type">{r.bloodType}</span>
                  <div className="lp-emg-info">
                    <strong>{r.title}</strong>
                    <span>
                      <svg viewBox="0 0 24 24" width="11" height="11" className="lp-emg-pin"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
                      {r.hospital}{r.city ? `, ${r.city}` : ''}
                    </span>
                  </div>
                  <time className="lp-emg-fullclock" aria-label={hasDeadline ? `${compact} remaining` : timeText}>{timeText}</time>
                  <span className={`lp-emg-tag${r.isUrgent ? ' lp-emg-tag-urgent' : ''}`}>{r.urgencyLabel}</span>
                  {donateTo && (
                    <Link to={donateTo} className="lp-btn lp-btn-primary lp-btn-sm">
                      {getUser() ? 'Respond in dashboard' : 'I can donate'}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}
