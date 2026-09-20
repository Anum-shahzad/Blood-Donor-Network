import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import TopBar from '../components/TopBar.jsx';

const FEATURES = [
  {
    title: 'Register as a donor',
    body: 'Set your blood group and city once. Toggle availability whenever your status changes — no forms to refill.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2.5c-3.5 4.3-6.5 8.2-6.5 11.8a6.5 6.5 0 0 0 13 0c0-3.6-3-7.5-6.5-11.8Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
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
        <path d="M3 19c0-2.8 2-4.5 4.5-4.5S12 16.2 12 19M12 19c0-2.8 2-4.5 4.5-4.5S21 16.2 21 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Verified by an admin',
    body: 'Genuine requests and donor blood groups are reviewed by an admin before they carry a verified badge.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M4 12.5 9.5 18 20 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
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
      <TopBar />

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

      <section className="section">
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
    </>
  );
}
