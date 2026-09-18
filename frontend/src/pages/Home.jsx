import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';

export default function Home() {
  const [status, setStatus] = useState('Checking backend connection...');

  useEffect(() => {
    apiGet('/api/health')
      .then((data) =>
        setStatus(
          data.db === 'connected'
            ? 'Backend and database are connected.'
            : 'Backend is up, but the database is not connected yet.'
        )
      )
      .catch(() => setStatus('Cannot reach the backend.'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Blood Donor & Emergency Request Network</h1>
      <p>{status}</p>
      <p>
        <Link to="/signup">Sign up</Link> · <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
