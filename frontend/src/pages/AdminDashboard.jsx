import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import TopBar from '../components/TopBar.jsx';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user = getUser();
  const [requests, setRequests] = useState([]);
  const [donors, setDonors] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadRequests();
    loadDonors();
  }, [navigate]);

  function loadRequests() {
    apiGet('/api/admin/requests').then(setRequests).catch((err) => setError(err.message));
  }

  function loadDonors() {
    apiGet('/api/admin/donors').then(setDonors).catch((err) => setError(err.message));
  }

  async function verifyRequest(id, verified) {
    setError('');
    try {
      await apiPatch(`/api/admin/requests/${id}/verify`, { verified });
      loadRequests();
    } catch (err) {
      setError(err.message);
    }
  }

  async function verifyDonor(id, verified) {
    setError('');
    try {
      await apiPatch(`/api/admin/donors/${id}/verify`, { verified });
      loadDonors();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  return (
    <>
      <TopBar user={user} onLogout={handleLogout} />
      <main className="page" style={{ maxWidth: 800 }}>
        <h1>Admin</h1>
        {error && <p className="error-banner">{error}</p>}

        <h2>Requests</h2>
        <p className="disclaimer" style={{ borderTop: 'none', paddingTop: 0 }}>
          Verifying confirms this is a genuine emergency request — it is not
          a medical judgment. Screening and crossmatching always happen at
          the donation facility.
        </p>
        {requests.length === 0 ? (
          <p className="empty-state">No requests yet.</p>
        ) : (
          requests.map((r) => (
            <div
              key={r.id}
              className={`record-card ${r.is_verified ? 'state-verified' : 'state-unverified'}`}
            >
              <div className="record-title">
                <span>
                  {r.requester_name} — {r.blood_group}
                </span>
                <span className={`badge ${r.is_verified ? 'badge-teal' : 'badge-red'}`}>
                  {r.is_verified ? 'Verified' : 'Unverified'}
                </span>
              </div>
              <p className="record-meta">
                {r.requester_email} · {r.hospital_name}, {r.city} · Status: {r.status}
              </p>
              <div className="record-actions">
                <button onClick={() => verifyRequest(r.id, !r.is_verified)} className="btn-text">
                  {r.is_verified ? 'Un-verify' : 'Verify'}
                </button>
              </div>
            </div>
          ))
        )}

        <h2>Donors</h2>
        <p className="disclaimer" style={{ borderTop: 'none', paddingTop: 0 }}>
          Verifying a donor's blood group confirms the platform has some
          basis for trusting the self-declared group — it is not a lab
          crossmatch.
        </p>
        {donors.length === 0 ? (
          <p className="empty-state">No donors yet.</p>
        ) : (
          donors.map((d) => (
            <div
              key={d.id}
              className={`record-card ${d.is_blood_group_verified ? 'state-verified' : 'state-unverified'}`}
            >
              <div className="record-title">
                <span>
                  {d.name} — {d.blood_group}
                </span>
                <span className={`badge ${d.is_blood_group_verified ? 'badge-teal' : 'badge-red'}`}>
                  {d.is_blood_group_verified ? 'Verified' : 'Unverified'}
                </span>
              </div>
              <p className="record-meta">
                {d.email} · {d.city} ·{' '}
                <span className={`badge ${d.is_available ? 'badge-teal' : 'badge-neutral'}`}>
                  {d.is_available ? 'Available' : 'Unavailable'}
                </span>
              </p>
              <div className="record-actions">
                <button onClick={() => verifyDonor(d.id, !d.is_blood_group_verified)} className="btn-text">
                  {d.is_blood_group_verified ? 'Un-verify' : 'Verify'}
                </button>
              </div>
            </div>
          ))
        )}
      </main>
    </>
  );
}
