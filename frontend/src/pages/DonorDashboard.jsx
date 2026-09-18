import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';

export default function DonorDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (!user) {
      navigate('/login');
      return;
    }
    apiGet('/api/donors/me')
      .then(setProfile)
      .catch((err) => setError(err.message));
  }, [navigate]);

  async function toggleAvailability() {
    if (!profile) return;
    setToggling(true);
    setError('');
    try {
      const next = !profile.is_available;
      await apiPatch('/api/donors/me/availability', { is_available: next });
      setProfile((p) => ({ ...p, is_available: next }));
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  if (error) {
    return (
      <main style={styles.main}>
        <p style={styles.error}>{error}</p>
        <button onClick={handleLogout}>Log out</button>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={styles.main}>
        <p>Loading your profile...</p>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <h1>Welcome, {profile.name}</h1>
      <dl style={styles.dl}>
        <dt>Blood group</dt>
        <dd>{profile.blood_group || 'Not set yet'}</dd>
        <dt>City</dt>
        <dd>{profile.city || 'Not set'}</dd>
        <dt>Last donation</dt>
        <dd>{profile.last_donation_date || 'None recorded'}</dd>
        <dt>Blood group verified</dt>
        <dd>{profile.is_blood_group_verified ? 'Yes' : 'Not yet'}</dd>
      </dl>

      <button onClick={toggleAvailability} disabled={toggling} style={styles.toggle(profile.is_available)}>
        {toggling
          ? 'Updating...'
          : profile.is_available
          ? "Available — tap to mark unavailable"
          : "Unavailable — tap to mark available"}
      </button>

      <p style={styles.disclaimer}>
        This status only tells nearby requesters you may be reachable. Final
        eligibility and screening always happen at the donation facility.
      </p>

      <button onClick={handleLogout} style={styles.logout}>
        Log out
      </button>
    </main>
  );
}

const styles = {
  main: { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480, margin: '0 auto' },
  dl: { display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: '0.5rem' },
  toggle: (available) => ({
    marginTop: '1.5rem',
    padding: '0.75rem 1rem',
    width: '100%',
    cursor: 'pointer',
    backgroundColor: available ? '#1b7a3d' : '#6b6b6b',
    color: 'white',
    border: 'none',
    borderRadius: 6,
  }),
  disclaimer: { fontSize: '0.85rem', color: '#555', marginTop: '1rem' },
  logout: { marginTop: '2rem', background: 'none', border: '1px solid #999', padding: '0.4rem 0.8rem', cursor: 'pointer' },
  error: { color: '#b00020' },
};
