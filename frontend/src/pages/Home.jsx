import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import TopBar from '../components/TopBar.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { DropletIcon, MapPinIcon, ShieldCheckIcon, GridIcon } from '../components/icons.jsx';

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#about', label: 'About' },
  { href: '#safety', label: 'Safety' },
];

const FEATURES = [
  {
    title: 'Register as a donor',
    body: 'Set your blood group and city once. Toggle availability whenever your status changes — no forms to refill.',
    icon: <DropletIcon size={20} />,
  },
  {
    title: 'Request blood in an emergency',
    body: 'Submit blood group, units, hospital, city, and urgency. Track status until the request is fulfilled or cancelled.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Get matched with nearby donors',
    body: 'Each request is checked against available, compatible donors — with the reasons for every match shown plainly.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="7" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M3 19c0-2.8 2-4.5 4.5-4.5S12 16.2 12 19M12 19c0-2.8 2-4.5 4.5-4.5S21 16.2 21 19"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: 'Verified by an admin',
    body: 'Genuine requests and donor blood groups are reviewed by an admin before they carry a verified badge.',
    icon: <ShieldCheckIcon size={20} />,
  },
];

const TRUST_POINTS = [
  {
    icon: <ShieldCheckIcon size={17} />,
    title: 'Admin-reviewed',
    body: 'Requests and donor blood groups carry a verified badge only after an admin checks them.',
  },
  {
    icon: <MapPinIcon size={17} />,
    title: 'City-matched',
    body: 'Matching favors donors in the same city as the request, not just the same blood group.',
  },
  {
    icon: <GridIcon size={17} />,
    title: 'Transparent status',
    body: 'Every request shows its real status — pending, verified, fulfilled, or cancelled — nothing hidden.',
  },
  {
    icon: <DropletIcon size={17} />,
    title: 'Compatibility, shown plainly',
    body: 'Each match lists the actual reasons behind its score instead of a black-box number.',
  },
];

export default function Home() {
  const [connected, setConnected] = useState(null);

  useEffect(() => {
    apiGet('/api/health')
      .then((data) => setConnected(data.db === 'connected'))
      .catch(() => setConnected(false));
  }, []);

  return (
    <>
      <TopBar navLinks={NAV_LINKS} />

      <section className="hero" style={{ backgroundImage: "url('/images/hero-blood-bag.jpg')" }}>
        <div className="hero-panel">
          <p className="hero-eyebrow">Sukkur, Pakistan</p>
          <h1>Finding a blood donor shouldn't depend on who saw your WhatsApp message.</h1>
          <p>
            When someone needs blood urgently, the shortage usually isn't
            donors — it's coordination. This platform connects people who need
            blood with donors who are actually available nearby, and tracks
            the request until it's resolved.
          </p>

          <div className="record-actions" style={{ marginTop: '1.5rem' }}>
            <Link to="/signup" className="btn btn-primary">
              Get started
            </Link>
            <Link to="/login" className="btn btn-secondary">
              Log in
            </Link>
          </div>

          {connected !== null && (
            <div className="hero-status">
              <span className={`hero-status-dot ${connected ? 'is-up' : 'is-down'}`} />
              {connected ? 'System status: operational' : 'System status: having trouble reaching the server'}
            </div>
          )}
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-heading">
          <p className="hero-eyebrow">How it works</p>
          <h2 style={{ marginTop: 0 }}>Built around coordination, not guesswork</h2>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <span className="feature-card-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="split-section" id="about">
        <div className="split-media">
          <img src="/images/hero-donation.jpg" alt="A blood donation being collected at a donation facility" />
        </div>
        <div className="split-content">
          <p className="hero-eyebrow">About this project</p>
          <h2>One place to coordinate, instead of a dozen scattered messages</h2>
          <p>
            Blood requests usually spread through forwarded messages and
            phone calls, with no way to tell who's already responded or
            whether a request is still open. This platform gives donors,
            requesters, and admins a shared, current view of the same
            information — who's available, what's needed, and what's
            already been verified.
          </p>
          <Link to="/signup" className="btn btn-primary">
            Create an account
          </Link>
        </div>
      </section>

      <section className="section" id="safety">
        <div className="section-heading">
          <p className="hero-eyebrow">Safety &amp; trust</p>
          <h2 style={{ marginTop: 0 }}>What "verified" actually means here</h2>
        </div>
        <div className="trust-grid">
          {TRUST_POINTS.map((t) => (
            <div className="trust-point" key={t.title}>
              <span className="trust-point-icon">{t.icon}</span>
              <div>
                <strong>{t.title}</strong>
                <span>{t.body}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="cta-band">
        <h2>This is a coordination tool, not a medical service.</h2>
        <p>
          It never performs blood screening or guarantees compatibility.
          Collection, testing, and final crossmatching always happen at an
          authorized hospital or blood bank.
        </p>
        <Link to="/signup" className="btn btn-secondary">
          Create an account
        </Link>
      </div>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div>
            <div className="site-footer-brand">
              <BrandMark onDark size={30} />
              Blood Donor Network
            </div>
            <p className="site-footer-tagline">
              A coordination platform for blood donors and requesters — not a
              substitute for hospital screening or crossmatching.
            </p>
          </div>
          <nav className="site-footer-links">
            <a href="#how-it-works">How it works</a>
            <a href="#about">About</a>
            <a href="#safety">Safety</a>
            <Link to="/login">Log in</Link>
            <Link to="/signup">Sign up</Link>
          </nav>
        </div>
        <p className="site-footer-bottom">Blood Donor &amp; Emergency Request Network</p>
      </footer>
    </>
  );
}
