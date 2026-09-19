import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import TopBar from '../components/TopBar.jsx';

export default function DonorDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const user = getUser();

  useEffect(() => {
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

  return (
    <>
      <TopBar user={user} onLogout={handleLogout} />
      <main className="page">
        <h1>Your donor profile</h1>

        {error && <p className="error-banner">{error}</p>}

        {!profile && !error && <p className="empty-state">Loading your profile...</p>}

        {profile && (
          <>
            <div className={`record-card state-${profile.is_available ? 'available' : 'closed'}`}>
              <div className="record-title">
                <span>{profile.blood_group || 'Blood group not set'}</span>
                <span className={`badge ${profile.is_blood_group_verified ? 'badge-teal' : 'badge-neutral'}`}>
                  {profile.is_blood_group_verified ? 'Verified' : 'Not verified'}
                </span>
              </div>
              <p className="record-meta">
                {profile.city || 'City not set'} · Last donation:{' '}
                {profile.last_donation_date || 'none recorded'}
              </p>
            </div>

            <button
              onClick={toggleAvailability}
              disabled={toggling}
              className={`availability-toggle ${profile.is_available ? 'is-available' : 'is-unavailable'}`}
            >
              {toggling
                ? 'Updating...'
                : profile.is_available
                ? 'Available — tap to mark unavailable'
                : 'Unavailable — tap to mark available'}
            </button>

            <p className="disclaimer">
              This status only tells nearby requesters you may be reachable.
              Final eligibility and screening always happen at the donation
              facility.
            </p>
          </>
        )}
      </main>
    </>
  );
}
