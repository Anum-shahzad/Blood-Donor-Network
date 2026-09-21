import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch, apiPost } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import { DropletIcon, MapPinIcon, CalendarIcon, ShieldCheckIcon } from '../components/icons.jsx';

const URGENCY_BADGE = {
  critical: 'badge-red',
  high: 'badge-red',
  medium: 'badge-amber',
  low: 'badge-neutral',
};

function committedStateLabel(status) {
  const labels = {
    MATCHED: 'Matched — awaiting your response',
    COMMITTED: 'Committed to an emergency',
    EN_ROUTE: 'On the way',
    ARRIVED: 'Arrived at facility',
    DONATING: 'Donating',
    DONATION_COMPLETED: 'Donation completed',
    COOLDOWN: 'In post-donation cooldown',
  };
  return labels[status] || status;
}

export default function DonorDashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [matches, setMatches] = useState([]);
  const [matchesReason, setMatchesReason] = useState('');
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [actingOn, setActingOn] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const user = getUser();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadAll();
  }, [navigate]);

  function loadAll() {
    apiGet('/api/donors/me')
      .then(setProfile)
      .catch((err) => setError(err.message));
    loadMatches();
  }

  function loadMatches() {
    apiGet('/api/donors/matches')
      .then((data) => {
        setMatches(data.matches || []);
        setMatchesReason(data.reason || '');
      })
      .catch((err) => setError(err.message));
  }

  async function toggleAvailability() {
    if (!profile) return;
    setToggling(true);
    setError('');
    try {
      const next = !profile.is_available;
      await apiPatch('/api/donors/me/availability', { is_available: next });
      setProfile((p) => ({ ...p, is_available: next }));
      loadMatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  }

  async function respondTo(requestId, action) {
    setActingOn(requestId);
    setError('');
    try {
      await apiPost(`/api/requests/${requestId}/${action}`, {});
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setActingOn(null);
    }
  }

  async function cancelCommitment() {
    setCancelling(true);
    setError('');
    try {
      await apiPost('/api/donors/me/commitment/cancel', {});
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  if (!user) return null;

  const isCommitted = profile?.current_status === 'COMMITTED';
  const isAvailableForMatching = profile?.current_status === 'AVAILABLE';

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
              <div className="stat-card-label">Current status</div>
              <div className="stat-card-value">
                <span className={`badge ${isAvailableForMatching ? 'badge-teal' : 'badge-amber'}`}>
                  {isAvailableForMatching ? 'Available' : committedStateLabel(profile.current_status)}
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
          <div className={`record-card state-${isAvailableForMatching ? 'available' : 'closed'}`}>
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

          {isCommitted && (
            <>
              <h2>Current commitment</h2>
              <div className="record-card state-critical">
                <div className="record-title">
                  <span>You're committed to request #{profile.committed_request_id}</span>
                  <span className="badge badge-amber">Committed</span>
                </div>
                <p className="record-meta">
                  You've been removed from matching for every other emergency while this
                  commitment is active. Coordinate with the requester and travel to an
                  authorized hospital or blood bank to donate.
                </p>
                <div className="record-actions">
                  <button onClick={() => setShowChat((v) => !v)} className="btn-text">
                    {showChat ? 'Hide chat' : 'Chat with requester'}
                  </button>
                  <button onClick={cancelCommitment} disabled={cancelling} className="btn-text">
                    {cancelling ? 'Cancelling...' : 'Cancel commitment'}
                  </button>
                </div>
                {showChat && (
                  <ChatPanel
                    requestId={profile.committed_request_id}
                    currentUserId={user.id}
                    onClose={() => setShowChat(false)}
                  />
                )}
              </div>
            </>
          )}

          <h2>Availability</h2>
          <button
            onClick={toggleAvailability}
            disabled={toggling || isCommitted}
            className={`availability-toggle ${profile.is_available ? 'is-available' : 'is-unavailable'}`}
          >
            {toggling
              ? 'Updating...'
              : isCommitted
              ? 'Unavailable while committed to an emergency'
              : profile.is_available
              ? 'Available — tap to mark unavailable'
              : 'Unavailable — tap to mark available'}
          </button>

          <p className="disclaimer">
            This status only tells nearby requesters you may be reachable.
            Final eligibility and screening always happen at the donation
            facility.
          </p>

          <h2>Compatible emergency requests</h2>
          {matches.length === 0 ? (
            <p className="empty-state">
              {matchesReason || 'No compatible verified emergencies right now.'}
            </p>
          ) : (
            matches.map((m) => (
              <div key={m.id} className="record-card state-critical">
                <div className="record-title">
                  <span>
                    {m.blood_group} · {m.units_needed} unit{m.units_needed > 1 ? 's' : ''}
                  </span>
                  <span className={`badge ${URGENCY_BADGE[m.urgency] || 'badge-neutral'}`}>{m.urgency}</span>
                </div>
                <p className="record-meta">{m.hospital_name}, {m.city}</p>
                <div className="record-actions">
                  <button
                    onClick={() => respondTo(m.id, 'accept')}
                    disabled={actingOn === m.id}
                    className="btn-text"
                  >
                    {actingOn === m.id ? 'Working...' : 'Accept'}
                  </button>
                  <button
                    onClick={() => respondTo(m.id, 'decline')}
                    disabled={actingOn === m.id}
                    className="btn-text"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          )}

          <p className="disclaimer">
            Accepting commits you to this one emergency and removes you from
            every other match until you cancel, donate, or the commitment
            ends. You'll travel to an authorized hospital or blood bank —
            the platform never asks a donor to transport blood themselves.
          </p>
        </>
      )}
    </DashboardLayout>
  );
}
