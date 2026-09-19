import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import TopBar from '../components/TopBar.jsx';

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
      <main className="page">
        <p className="hero-eyebrow">Sukkur, Pakistan</p>
        <h1>Finding a blood donor shouldn't depend on who saw your WhatsApp message.</h1>
        <p>
          When someone needs blood urgently, the shortage usually isn't
          donors — it's coordination. This platform connects people who need
          blood with donors who are actually available nearby, and tracks
          the request until it's resolved.
        </p>
        <p className="disclaimer" style={{ borderTop: 'none', paddingTop: 0 }}>
          This is a coordination tool, not a medical service. It never
          performs blood screening or guarantees compatibility — collection,
          testing, and final crossmatching always happen at an authorized
          hospital or blood bank.
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
          <p className="empty-state" style={{ marginTop: '2rem', fontSize: '0.8rem' }}>
            {connected ? 'System status: operational' : 'System status: having trouble reaching the server'}
          </p>
        )}
      </main>
    </>
  );
}
