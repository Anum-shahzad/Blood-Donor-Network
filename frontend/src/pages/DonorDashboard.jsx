import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';
import { DropletIcon, MapPinIcon, CalendarIcon, ShieldCheckIcon } from '../components/icons.jsx';

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

  if (!user) return null;

  return (
    <DashboardLayout user={user} onLogout={handleLogout}>
      <div className="dashboard-header">
        <h1>Welcome back, {user.name}</h1>
        <p className="dashboard-subtext">Here's your current donor status.</p>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {!profile && !error && <p className="empty-state">Loading your profile...</p>}

      {profile && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-card-label">
                Blood Group
                <DropletIcon size={16} />
              </div>
              <div className="stat-card-value">{profile.blood_group || 'Not set'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Availability</div>
              <div className="stat-card-value">
                <span className={`badge ${profile.is_available ? 'badge-teal' : 'badge-neutral'}`}>
                  {profile.is_available ? 'Available' : 'Unavailable'}
                </span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">
                Verification
                <ShieldCheckIcon size={16} />
              </div>
              <div className="stat-card-value">
                <span className={`badge ${profile.is_blood_group_verified ? 'badge-teal' : 'badge-neutral'}`}>
                  {profile.is_blood_group_verified ? 'Verified' : 'Not verified'}
                </span>
              </div>
            </div>
          </div>

          <h2 style={{ marginTop: 0 }}>Your profile</h2>
          <div className={`record-card state-${profile.is_available ? 'available' : 'closed'}`}>
            <div className="record-title">
              <span>{user.name}</span>
              <span className={`badge ${profile.is_blood_group_verified ? 'badge-teal' : 'badge-neutral'}`}>
                {profile.is_blood_group_verified ? 'Verified' : 'Not verified'}
              </span>
            </div>
            <p className="record-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <DropletIcon size={14} /> {profile.blood_group || 'Blood group not set'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <MapPinIcon size={14} /> {profile.city || 'City not set'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <CalendarIcon size={14} /> Last donation: {profile.last_donation_date || 'none recorded'}
              </span>
            </p>
          </div>

          <h2>Availability</h2>
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
    </DashboardLayout>
  );
}
