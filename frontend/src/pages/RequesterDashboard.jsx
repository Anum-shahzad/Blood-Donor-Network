import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];

const emptyForm = {
  blood_group: '',
  units_needed: 1,
  hospital_name: '',
  city: '',
  urgency: 'medium',
  required_by: '',
};

export default function RequesterDashboard() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [matchesByRequest, setMatchesByRequest] = useState({});
  const [matchError, setMatchError] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (!user) {
      navigate('/login');
      return;
    }
    loadRequests();
  }, [navigate]);

  function loadRequests() {
    apiGet('/api/requests/mine')
      .then(setRequests)
      .catch((err) => setError(err.message));
  }

  function loadMatches(requestId) {
    setMatchError((m) => ({ ...m, [requestId]: '' }));
    apiGet(`/api/requests/${requestId}/matches`)
      .then((data) => setMatchesByRequest((m) => ({ ...m, [requestId]: data })))
      .catch((err) => setMatchError((m) => ({ ...m, [requestId]: err.message })));
  }

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiPost('/api/requests', {
        ...form,
        units_needed: Number(form.units_needed),
        required_by: form.required_by || undefined,
      });
      setForm(emptyForm);
      loadRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  return (
    <main style={styles.main}>
      <h1>Your blood requests</h1>

      <form onSubmit={handleSubmit} style={styles.form}>
        <h2 style={styles.h2}>Create a new request</h2>
        <label>
          Blood group needed
          <select value={form.blood_group} onChange={update('blood_group')} required style={styles.input}>
            <option value="" disabled>
              Select blood group
            </option>
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>
                {bg}
              </option>
            ))}
          </select>
        </label>
        <label>
          Units needed
          <input
            type="number"
            min={1}
            max={20}
            value={form.units_needed}
            onChange={update('units_needed')}
            required
            style={styles.input}
          />
        </label>
        <label>
          Hospital / facility
          <input value={form.hospital_name} onChange={update('hospital_name')} required style={styles.input} />
        </label>
        <label>
          City
          <input value={form.city} onChange={update('city')} required style={styles.input} />
        </label>
        <label>
          Urgency
          <select value={form.urgency} onChange={update('urgency')} style={styles.input}>
            {URGENCY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          Needed by (optional)
          <input type="datetime-local" value={form.required_by} onChange={update('required_by')} style={styles.input} />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Submitting...' : 'Create request'}
        </button>
      </form>

      <p style={styles.disclaimer}>
        Submitting a request does not guarantee a donor or confirm medical
        eligibility. A hospital or admin verifies genuine requests, and final
        screening always happens at the donation facility.
      </p>

      <h2 style={styles.h2}>Your requests</h2>
      {requests.length === 0 ? (
        <p>You haven't created any requests yet.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Blood group</th>
              <th>Units</th>
              <th>Hospital</th>
              <th>City</th>
              <th>Urgency</th>
              <th>Status</th>
              <th>Verified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.blood_group}</td>
                <td>{r.units_needed}</td>
                <td>{r.hospital_name}</td>
                <td>{r.city}</td>
                <td>{r.urgency}</td>
                <td>{r.status}</td>
                <td>{r.is_verified ? 'Yes' : 'Not yet'}</td>
                <td>
                  <button onClick={() => loadMatches(r.id)} style={styles.linkButton}>
                    View matches
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {requests.map((r) => {
        const data = matchesByRequest[r.id];
        const err = matchError[r.id];
        if (!data && !err) return null;
        return (
          <div key={`matches-${r.id}`} style={styles.matchesPanel}>
            <h3>
              Matches for request #{r.id} ({r.blood_group}, {r.city})
            </h3>
            {err && <p style={styles.error}>{err}</p>}
            {data && data.matches.length === 0 && <p>No available compatible donors found right now.</p>}
            {data && data.matches.length > 0 && (
              <ol>
                {data.matches.map((m) => (
                  <li key={m.donor_id}>
                    <strong>{m.name}</strong> — {m.blood_group}, {m.city || 'city not set'} — score {m.score}
                    <br />
                    <span style={styles.reasons}>{m.reasons.join(' · ')}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}

      <button onClick={handleLogout} style={styles.logout}>
        Log out
      </button>
    </main>
  );
}

const styles = {
  main: { fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640, margin: '0 auto' },
  h2: { marginTop: '2rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem' },
  button: { padding: '0.6rem', marginTop: '0.5rem', cursor: 'pointer' },
  error: { color: '#b00020' },
  disclaimer: { fontSize: '0.85rem', color: '#555', marginTop: '1rem' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '1rem' },
  linkButton: { background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  matchesPanel: { marginTop: '1.5rem', padding: '1rem', border: '1px solid #ddd', borderRadius: 6 },
  reasons: { fontSize: '0.85rem', color: '#555' },
  logout: { marginTop: '2rem', background: 'none', border: '1px solid #999', padding: '0.4rem 0.8rem', cursor: 'pointer' },
};
