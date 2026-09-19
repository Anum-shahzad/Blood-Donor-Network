import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [donors, setDonors] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = getUser();
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
    <main style={styles.main}>
      <h1>Admin</h1>
      {error && <p style={styles.error}>{error}</p>}

      <h2 style={styles.h2}>Requests</h2>
      <p style={styles.note}>
        Verifying confirms this is a genuine emergency request — it is not a
        medical judgment. Screening and crossmatching always happen at the
        donation facility.
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>Requester</th>
            <th>Blood group</th>
            <th>Hospital</th>
            <th>City</th>
            <th>Status</th>
            <th>Verified</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>
                {r.requester_name}
                <br />
                <span style={styles.muted}>{r.requester_email}</span>
              </td>
              <td>{r.blood_group}</td>
              <td>{r.hospital_name}</td>
              <td>{r.city}</td>
              <td>{r.status}</td>
              <td>{r.is_verified ? 'Yes' : 'No'}</td>
              <td>
                <button onClick={() => verifyRequest(r.id, !r.is_verified)} style={styles.linkButton}>
                  {r.is_verified ? 'Un-verify' : 'Verify'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={styles.h2}>Donors</h2>
      <p style={styles.note}>
        Verifying a donor's blood group confirms the platform has some basis
        for trusting the self-declared group — it is not a lab crossmatch.
      </p>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>City</th>
            <th>Blood group</th>
            <th>Available</th>
            <th>Verified</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {donors.map((d) => (
            <tr key={d.id}>
              <td>
                {d.name}
                <br />
                <span style={styles.muted}>{d.email}</span>
              </td>
              <td>{d.city}</td>
              <td>{d.blood_group}</td>
              <td>{d.is_available ? 'Yes' : 'No'}</td>
              <td>{d.is_blood_group_verified ? 'Yes' : 'No'}</td>
              <td>
                <button onClick={() => verifyDonor(d.id, !d.is_blood_group_verified)} style={styles.linkButton}>
                  {d.is_blood_group_verified ? 'Un-verify' : 'Verify'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button onClick={handleLogout} style={styles.logout}>
        Log out
      </button>
    </main>
  );
}

const styles = {
  main: { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 900, margin: '0 auto' },
  h2: { marginTop: '2rem' },
  note: { fontSize: '0.85rem', color: '#555' },
  muted: { fontSize: '0.8rem', color: '#777' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' },
  linkButton: { background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  logout: { marginTop: '2rem', background: 'none', border: '1px solid #999', padding: '0.4rem 0.8rem', cursor: 'pointer' },
  error: { color: '#b00020' },
};
