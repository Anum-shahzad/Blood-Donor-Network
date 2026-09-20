import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];
const CLOSED_STATUSES = ['fulfilled', 'cancelled', 'expired'];

const emptyForm = {
  blood_group: '',
  units_needed: 1,
  hospital_name: '',
  city: '',
  urgency: 'medium',
  required_by: '',
};

function stateClassFor(request) {
  if (CLOSED_STATUSES.includes(request.status)) return 'state-closed';
  if (request.is_verified) return 'state-verified';
  if (request.urgency === 'critical') return 'state-critical';
  return 'state-pending';
}

function urgencyBadgeClass(urgency) {
  if (urgency === 'critical' || urgency === 'high') return 'badge-red';
  if (urgency === 'medium') return 'badge-amber';
  return 'badge-neutral';
}

export default function RequesterDashboard() {
  const navigate = useNavigate();
  const user = getUser();
  const [requests, setRequests] = useState([]);
  const [matchesByRequest, setMatchesByRequest] = useState({});
  const [matchError, setMatchError] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
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

  async function updateStatus(requestId, status) {
    setError('');
    try {
      await apiPatch(`/api/requests/${requestId}/status`, { status });
      loadRequests();
    } catch (err) {
      setError(err.message);
    }
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

  if (!user) return null;

  // Derived client-side from the requests already loaded above — not a
  // separate API call and nothing the backend doesn't already tell us.
  const activeCount = requests.filter((r) => !CLOSED_STATUSES.includes(r.status)).length;
  const fulfilledCount = requests.filter((r) => r.status === 'fulfilled').length;
  const criticalCount = requests.filter(
    (r) => r.urgency === 'critical' && !CLOSED_STATUSES.includes(r.status)
  ).length;

  return (
    <DashboardLayout user={user} onLogout={handleLogout}>
      <div className="dashboard-header">
        <h1>Welcome back, {user.name}</h1>
        <p className="dashboard-subtext">Here's an overview of your blood requests.</p>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {requests.length > 0 && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-label">Active Requests</div>
            <div className="stat-card-value">{activeCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Fulfilled</div>
            <div className="stat-card-value">{fulfilledCount}</div>
          </div>
          <div className="stat-card stat-card--accent">
            <div className="stat-card-label">Critical</div>
            <div className="stat-card-value">{criticalCount}</div>
          </div>
        </div>
      )}

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <h2 style={{ marginTop: 0 }}>Create a new request</h2>

          <label className="field">
            Blood group needed
            <select value={form.blood_group} onChange={update('blood_group')} required>
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
          <label className="field">
            Units needed
            <input type="number" min={1} max={20} value={form.units_needed} onChange={update('units_needed')} required />
          </label>
          <label className="field">
            Hospital / facility
            <input value={form.hospital_name} onChange={update('hospital_name')} required />
          </label>
          <label className="field">
            City
            <input value={form.city} onChange={update('city')} required />
          </label>
          <label className="field">
            Urgency
            <div className="segmented">
              {URGENCY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  data-level={level}
                  className={`segmented-option${form.urgency === level ? ' is-active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, urgency: level }))}
                >
                  {level}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Needed by (optional)
            <input type="datetime-local" value={form.required_by} onChange={update('required_by')} />
          </label>

          <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
            {submitting ? 'Submitting...' : 'Create request'}
          </button>

          <p className="disclaimer">
            Submitting a request does not guarantee a donor or confirm
            medical eligibility. A hospital or admin verifies genuine
            requests, and final screening always happens at the donation
            facility.
          </p>
        </form>
      </div>

      <h2>Your requests</h2>
      {requests.length === 0 ? (
        <p className="empty-state">You haven't created any requests yet.</p>
      ) : (
        requests.map((r) => {
          const closed = CLOSED_STATUSES.includes(r.status);
          const data = matchesByRequest[r.id];
          const err = matchError[r.id];
          return (
            <div key={r.id} className={`record-card ${stateClassFor(r)}`}>
              <div className="record-title">
                <span>
                  {r.blood_group} · {r.units_needed} unit{r.units_needed > 1 ? 's' : ''}
                </span>
                <span className={`badge ${urgencyBadgeClass(r.urgency)}`}>{r.urgency}</span>
              </div>
              <p className="record-meta">
                {r.hospital_name}, {r.city} · Status: {r.status} · Verified:{' '}
                {r.is_verified ? 'Yes' : 'Not yet'}
              </p>

              {!closed && (
                <div className="record-actions">
                  <button onClick={() => loadMatches(r.id)} className="btn-text">
                    View matches
                  </button>
                  <button onClick={() => updateStatus(r.id, 'fulfilled')} className="btn-text">
                    Mark fulfilled
                  </button>
                  <button onClick={() => updateStatus(r.id, 'cancelled')} className="btn-text">
                    Cancel
                  </button>
                </div>
              )}

              {(data || err) && (
                <div className="form-card" style={{ marginTop: '0.75rem' }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem' }}>
                    Potential matches
                  </strong>
                  {err && <p className="error-banner" style={{ marginTop: '0.5rem' }}>{err}</p>}
                  {data && data.matches.length === 0 && (
                    <p className="empty-state">No available compatible donors right now.</p>
                  )}
                  {data && data.matches.length > 0 && (
                    <div style={{ marginTop: '0.6rem' }}>
                      {data.matches.map((m) => (
                        <div
                          key={m.donor_id}
                          className="record-card"
                          style={{ borderLeftColor: 'var(--success)', marginBottom: '0.5rem' }}
                        >
                          <div className="record-title">
                            <span>
                              {m.blood_group} · {m.name}
                            </span>
                            <span className="badge badge-teal">Score {m.score}</span>
                          </div>
                          <p className="record-meta">{m.city || 'City not set'}</p>
                          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                            {m.reasons.map((reason, i) => (
                              <li key={i}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      <p className="disclaimer">
                        These scores reflect blood-group compatibility and
                        stated availability only — not a medical guarantee.
                        Final crossmatching always happens at the donation
                        facility.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </DashboardLayout>
  );
}
