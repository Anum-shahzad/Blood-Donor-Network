import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import {
  DropletIcon,
  MapPinIcon,
  CalendarIcon,
  ShieldCheckIcon,
  ClockIcon,
  HeartIcon,
  FileTextIcon,
  RadarIcon,
  ArchiveIcon,
  PhoneIcon,
  HospitalIcon,
  AlertCircleIcon,
  CheckCircleIcon,
} from '../components/icons.jsx';
import { formatDateTime, formatDate, humanizeStatus, localInputToIso, nowForLocalInput } from '../lib/format.js';

const REFRESH_MS = 25 * 1000;

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];
const CLOSED_STATUSES = ['fulfilled', 'cancelled', 'expired'];

const SUKKUR_HOSPITALS = [
  'Sukkur Civil Hospital (Minara Rd)',
  'SIUT Chhablani Medical Center Sukkur',
  'Ghulam Muhammad Mahar Medical College (GMMMC)',
  'Red Crescent Society Blood Bank Sukkur',
  'Hira Medical Center Sukkur',
];

const emptyForm = {
  blood_group: '',
  units_needed: 1,
  hospital_name: SUKKUR_HOSPITALS[0],
  city: 'Sukkur IBA Area',
  urgency: 'high',
  required_by: '',
  patient_case: '',
  contact_phone: '',
  attendant_name: '',
  prescription_slip: '',
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
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'tab-active';

  const [requests, setRequests] = useState([]);
  const [archiveData, setArchiveData] = useState({ archive: [], stats: {} });
  const [selectedRadarRequestId, setSelectedRadarRequestId] = useState(null);
  const [radarMatches, setRadarMatches] = useState(null);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState('');
  const [alertSuccess, setAlertSuccess] = useState('');

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [openChats, setOpenChats] = useState({});

  useEffect(() => {
    loadRequests();
    loadArchive();
    const t = setInterval(() => {
      if (!document.hidden) {
        loadRequests();
        loadArchive();
      }
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  function setTab(tabId) {
    setSearchParams({ tab: tabId });
    setError('');
    setSuccessMsg('');
    setAlertSuccess('');
  }

  function loadRequests() {
    apiGet('/api/requests/mine')
      .then((data) => {
        setRequests(data || []);
        // Default radar request if not selected
        if (!selectedRadarRequestId && data?.length > 0) {
          const firstActive = data.find((r) => !CLOSED_STATUSES.includes(r.status));
          if (firstActive) {
            setSelectedRadarRequestId(firstActive.id);
            fetchRadar(firstActive.id);
          }
        }
      })
      .catch((err) => setError(err.message));
  }

  function loadArchive() {
    apiGet('/api/requests/archive')
      .then((data) => setArchiveData(data || { archive: [], stats: {} }))
      .catch(() => {});
  }

  function fetchRadar(requestId) {
    if (!requestId) return;
    setRadarLoading(true);
    setRadarError('');
    apiGet(`/api/requests/${requestId}/matches`)
      .then((data) => {
        setRadarMatches(data);
        setSelectedRadarRequestId(requestId);
      })
      .catch((err) => setRadarError(err.message))
      .finally(() => setRadarLoading(false));
  }

  async function updateStatus(requestId, status) {
    setError('');
    const verb = status === 'fulfilled' ? 'mark this request as fulfilled' : 'cancel this request';
    if (!window.confirm(`Are you sure you want to ${verb}? This updates the network status and closes active matching.`)) return;
    try {
      await apiPatch(`/api/requests/${requestId}/status`, { status });
      setSuccessMsg(`Request #${requestId} has been marked as ${status}.`);
      setOpenChats((c) => ({ ...c, [requestId]: false }));
      loadRequests();
      loadArchive();
    } catch (err) {
      setError(err.message);
    }
  }

  async function dispatchDonorAlert(requestId, donorId) {
    setAlertSuccess('');
    setError('');
    try {
      const res = await apiPost(`/api/requests/${requestId}/alert/${donorId}`, {});
      setAlertSuccess(res.message || 'Emergency alert dispatched to donor.');
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleChat(requestId) {
    setOpenChats((c) => ({ ...c, [requestId]: !c[requestId] }));
  }

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSubmitting(true);
    try {
      const res = await apiPost('/api/requests', {
        ...form,
        units_needed: Number(form.units_needed),
        required_by: localInputToIso(form.required_by),
      });
      setForm(emptyForm);
      setSuccessMsg(`Emergency request #${res.id} created successfully! Admin verification queue has been notified.`);
      loadRequests();
      setTab('tab-active');
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

  const activeRequests = requests.filter((r) => !CLOSED_STATUSES.includes(r.status));
  const fulfilledCount = archiveData?.stats?.total_fulfilled ?? requests.filter((r) => r.status === 'fulfilled').length;
  const criticalCount = activeRequests.filter((r) => r.urgency === 'critical').length;
  const totalUnitsSourced = archiveData?.stats?.total_units_received || 0;

  return (
    <DashboardLayout user={user} onLogout={handleLogout}>
      {/* Top Header */}
      <div className="dashboard-header">
        <h1>Sukkur Blood Network &mdash; Requester Portal</h1>
        <p className="dashboard-subtext">
          Post urgent blood requests, track real-time fulfillment, and coordinate with verified donors across Sukkur &amp; Rohri.
        </p>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {successMsg && (
        <div className="badge badge-teal" style={{ display: 'block', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
          {successMsg}
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-label">Active Requests</div>
          <div className="stat-card-value">{activeRequests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Fulfilled Emergencies</div>
          <div className="stat-card-value">{fulfilledCount}</div>
        </div>
        <div className="stat-card stat-card--accent">
          <div className="stat-card-label">Critical Pending</div>
          <div className="stat-card-value">{criticalCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Units Sourced</div>
          <div className="stat-card-value">{totalUnitsSourced} Bags</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="tab-nav" aria-label="Requester Dashboard Tabs">
        <button
          onClick={() => setTab('tab-active')}
          className={`tab-btn ${activeTab === 'tab-active' ? 'is-active' : ''}`}
        >
          <ClockIcon size={16} />
          <span>My Active Requests</span>
          <span className="tab-badge">{activeRequests.length}</span>
        </button>

        <button
          onClick={() => setTab('tab-post')}
          className={`tab-btn ${activeTab === 'tab-post' ? 'is-active' : ''}`}
        >
          <FileTextIcon size={16} />
          <span>Post Emergency Request</span>
        </button>

        <button
          onClick={() => setTab('tab-radar')}
          className={`tab-btn ${activeTab === 'tab-radar' ? 'is-active' : ''}`}
        >
          <RadarIcon size={16} />
          <span>Matched Donors Radar</span>
          {radarMatches?.match_count ? <span className="tab-badge">{radarMatches.match_count}</span> : null}
        </button>

        <button
          onClick={() => setTab('tab-archive')}
          className={`tab-btn ${activeTab === 'tab-archive' ? 'is-active' : ''}`}
        >
          <ArchiveIcon size={16} />
          <span>Past Requests Archive</span>
        </button>
      </nav>

      {/* ================================================================= */}
      {/* TAB 1: MY ACTIVE REQUESTS                                        */}
      {/* ================================================================= */}
      {activeTab === 'tab-active' && (
        <div className="tab-content stack" style={{ gap: '1.25rem' }}>
          {activeRequests.length === 0 ? (
            <div className="form-card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
              <ClockIcon size={40} />
              <h3 style={{ marginTop: '0.75rem', marginBottom: '0.35rem' }}>No Open Emergency Requests</h3>
              <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem', maxWidth: '50ch', margin: '0 auto 1.5rem' }}>
                You have no active emergency requests waiting for donor responses. Create a request whenever blood is needed.
              </p>
              <button onClick={() => setTab('tab-post')} className="btn btn-primary">
                + Post New Emergency Request
              </button>
            </div>
          ) : (
            activeRequests.map((r) => {
              const isOpen = !CLOSED_STATUSES.includes(r.status);
              return (
                <div key={r.id} className={`record-card ${stateClassFor(r)}`}>
                  <div className="record-title" style={{ alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--primary)',
                          color: '#fff',
                          fontWeight: 900,
                          fontSize: '1.2rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        {r.blood_group}
                      </div>
                      <div>
                        <strong style={{ fontSize: '1.05rem', display: 'block' }}>
                          {r.patient_case || `Emergency Request #${r.id}`}
                        </strong>
                        <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                          {r.hospital_name}, {r.city} &bull; {r.units_needed} Unit(s) Needed
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span className={`badge ${urgencyBadgeClass(r.urgency)}`}>{r.urgency}</span>
                      <span className={`badge ${r.is_verified ? 'badge-teal' : 'badge-amber'}`}>
                        {r.is_verified ? 'Verified' : 'Pending Verification'}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      background: 'var(--paper)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.75rem 1rem',
                      margin: '0.85rem 0',
                      fontSize: '0.82rem',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '0.75rem',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>LIFECYCLE STATUS</span>
                      <strong>{humanizeStatus(r.status)}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>MATCHED DONORS RADAR</span>
                      <strong style={{ color: 'var(--primary)' }}>{r.matched_donors_count || 0} Nearby Compatible</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>POSTED ON</span>
                      <span>{formatDateTime(r.created_at)}</span>
                    </div>
                    {r.required_by && (
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>DEADLINE</span>
                        <strong style={{ color: 'var(--amber)' }}>{formatDateTime(r.required_by)}</strong>
                      </div>
                    )}
                  </div>

                  {!r.is_verified && (
                    <p style={{ fontSize: '0.82rem', color: 'var(--amber)', margin: '0 0 0.75rem' }}>
                      <ClockIcon size={12} /> Awaiting admin verification &mdash; hospital badge verification speeds up donor alerts.
                    </p>
                  )}

                  <div className="record-actions">
                    <button
                      onClick={() => {
                        setSelectedRadarRequestId(r.id);
                        fetchRadar(r.id);
                        setTab('tab-radar');
                      }}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
                    >
                      <RadarIcon size={14} /> View Matched Donors Radar
                    </button>

                    {r.status === 'donor_accepted' && (
                      <button
                        onClick={() => toggleChat(r.id)}
                        className="btn btn-primary"
                        style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
                      >
                        {openChats[r.id] ? 'Hide Donor Chat' : 'Chat with Committed Donor'}
                      </button>
                    )}

                    <button
                      onClick={() => updateStatus(r.id, 'fulfilled')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem', borderColor: 'var(--success)', color: '#15803d' }}
                    >
                      <CheckCircleIcon size={14} /> Mark as Fulfilled
                    </button>

                    <button
                      onClick={() => updateStatus(r.id, 'cancelled')}
                      className="btn btn-text"
                      style={{ fontSize: '0.85rem', marginLeft: 'auto', color: 'var(--primary)' }}
                    >
                      Cancel Request
                    </button>
                  </div>

                  {r.status === 'donor_accepted' && openChats[r.id] && (
                    <div style={{ marginTop: '1rem' }}>
                      <ChatPanel
                        requestId={r.id}
                        currentUserId={user.id}
                        onClose={() => toggleChat(r.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: POST EMERGENCY REQUEST                                     */}
      {/* ================================================================= */}
      {activeTab === 'tab-post' && (
        <div className="tab-content" style={{ maxWidth: 680, margin: '0 auto' }}>
          <div className="form-card">
            <h2 style={{ marginTop: 0, fontSize: '1.25rem', marginBottom: '0.35rem' }}>
              Post Emergency Blood Request
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: '1.25rem' }}>
              Emergency requests immediately alert compatible registered donors across Sukkur &amp; Rohri.
            </p>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="field">
                  Blood Group Needed
                  <select value={form.blood_group} onChange={update('blood_group')} required>
                    <option value="" disabled>Select blood group</option>
                    {BLOOD_GROUPS.map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  Units Needed (Bags)
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={form.units_needed}
                    onChange={update('units_needed')}
                    required
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="field">
                  Hospital / Center in Sukkur
                  <select value={form.hospital_name} onChange={update('hospital_name')} required>
                    {SUKKUR_HOSPITALS.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  Sukkur Area / Sector
                  <select value={form.city} onChange={update('city')} required>
                    <option value="Sukkur IBA Area">Sukkur IBA / Airport Rd</option>
                    <option value="Civil Hospital Sukkur">Minara Road / Civil Hospital</option>
                    <option value="Military Road Sukkur">Military Road / Cantonment</option>
                    <option value="Rohri">Rohri City</option>
                    <option value="Pano Aqil">Pano Aqil Area</option>
                  </select>
                </label>
              </div>

              <label className="field">
                Patient Medical Case / Diagnosis
                <input
                  type="text"
                  placeholder="e.g. Emergency C-Section, Thalassemia Major Child, Trauma Ward"
                  value={form.patient_case}
                  onChange={update('patient_case')}
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="field">
                  Attendant / Contact Person
                  <input
                    type="text"
                    placeholder="e.g. Kashif Memon (Brother)"
                    value={form.attendant_name}
                    onChange={update('attendant_name')}
                    required
                  />
                </label>

                <label className="field">
                  Emergency Phone Number
                  <input
                    type="tel"
                    placeholder="e.g. 03001234567"
                    value={form.contact_phone}
                    onChange={update('contact_phone')}
                    required
                  />
                </label>
              </div>

              <label className="field">
                Urgency Level
                <div className="segmented">
                  {URGENCY_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      data-level={level}
                      className={`segmented-option${form.urgency === level ? ' is-active' : ''}`}
                      onClick={() => setForm((f) => ({ ...f, urgency: level }))}
                    >
                      {level === 'critical' ? 'Critical (< 2h)' : level === 'high' ? 'High (< 6h)' : level === 'medium' ? 'Medium' : 'Low'}
                    </button>
                  ))}
                </div>
              </label>

              <label className="field">
                Needed By Deadline (Optional)
                <input
                  type="datetime-local"
                  min={nowForLocalInput()}
                  value={form.required_by}
                  onChange={update('required_by')}
                />
              </label>

              <label className="field">
                Hospital Prescription / Slip Reference (Section 3.5 Verification)
                <input
                  type="text"
                  placeholder="e.g. Doctor slip #CS-8921 or Doctor on Duty Name"
                  value={form.prescription_slip}
                  onChange={update('prescription_slip')}
                />
              </label>

              <button type="submit" disabled={submitting} className="btn btn-primary btn-block" style={{ marginTop: '0.75rem' }}>
                {submitting ? 'Submitting Request...' : 'Post Emergency Request'}
              </button>

              <p className="disclaimer" style={{ marginTop: '1rem' }}>
                Rate-limit policy enforced: Maximum 3 requests allowed per 24 hours per user to prevent system abuse.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: MATCHED DONORS RADAR                                      */}
      {/* ================================================================= */}
      {activeTab === 'tab-radar' && (
        <div className="tab-content stack" style={{ gap: '1.25rem' }}>
          {/* Active Request Selector */}
          <div className="form-card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <RadarIcon size={20} /> Matched Donors Radar
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                Ranked by blood compatibility, geographical proximity in Sukkur, and post-donation recency.
              </p>
            </div>

            {activeRequests.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Active Request:</span>
                <select
                  value={selectedRadarRequestId || ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSelectedRadarRequestId(id);
                    fetchRadar(id);
                  }}
                  style={{
                    padding: '0.45rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    background: 'var(--surface)',
                    fontSize: '0.85rem',
                  }}
                >
                  {activeRequests.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} &mdash; {r.blood_group} ({r.hospital_name})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {alertSuccess && (
            <div className="badge badge-teal" style={{ display: 'block', padding: '0.65rem 0.85rem', fontSize: '0.9rem' }}>
              {alertSuccess}
            </div>
          )}

          {radarLoading && <p className="empty-state">Scanning Sukkur donor network for compatible matches...</p>}
          {radarError && <p className="error-banner">{radarError}</p>}

          {!radarLoading && radarMatches && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.88rem', color: 'var(--ink-muted)' }}>
                  Showing compatible donors for blood group <strong style={{ color: 'var(--primary)' }}>{radarMatches.compatible_blood_groups?.join(', ')}</strong>
                </span>
                <span className="badge badge-teal">{radarMatches.match_count} Donors Found</span>
              </div>

              {radarMatches.matches?.length === 0 ? (
                <div className="form-card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                  <RadarIcon size={36} />
                  <p className="empty-state" style={{ marginTop: '0.75rem' }}>
                    No currently available donors matching this request in Sukkur &amp; Rohri.
                  </p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                    Donors in medical cooldown or paused availability are automatically excluded for safety.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
                  {radarMatches.matches.map((m) => (
                    <div
                      key={m.id || m.donor_id}
                      className="record-card state-available"
                      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                    >
                      <div>
                        <div className="record-title">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{m.name}</span>
                            <span className="badge badge-red">{m.blood_group}</span>
                          </div>
                          <span className="badge badge-teal">Score {m.score || 85}</span>
                        </div>

                        <p className="record-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                          <MapPinIcon size={14} /> {m.city || 'Sukkur'}
                          {m.is_blood_group_verified && (
                            <span style={{ color: '#15803d', marginLeft: 'auto', fontWeight: 600 }}>
                              <ShieldCheckIcon size={12} /> Group Verified
                            </span>
                          )}
                        </p>

                        <div style={{ background: 'var(--paper)', borderRadius: 'var(--radius-sm)', padding: '0.65rem 0.85rem', fontSize: '0.8rem', border: '1px solid var(--border)', marginBottom: '0.75rem' }}>
                          <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '0.2rem' }}>RANKING FACTORS</span>
                          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--ink)' }}>
                            {m.reasons?.map((reason, i) => (
                              <li key={i}>{reason}</li>
                            )) || <li>Compatible blood group</li>}
                          </ul>
                        </div>
                      </div>

                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => dispatchDonorAlert(selectedRadarRequestId, m.id || m.donor_id)}
                          className="btn btn-primary"
                          style={{ flex: 1, fontSize: '0.82rem', padding: '0.5rem' }}
                        >
                          Dispatch Urgent Alert
                        </button>

                        {m.phone && !m.phone_masked && (
                          <a
                            href={`tel:${m.phone}`}
                            className="btn btn-secondary"
                            style={{ padding: '0.5rem 0.75rem' }}
                            title="Direct Phone Call"
                          >
                            <PhoneIcon size={14} />
                          </a>
                        )}

                        {m.phone && !m.phone_masked && (
                          <a
                            href={`https://wa.me/${m.phone.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: '0.5rem 0.75rem' }}
                            title="WhatsApp Chat"
                          >
                            WA
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: PAST REQUESTS ARCHIVE                                     */}
      {/* ================================================================= */}
      {activeTab === 'tab-archive' && (
        <div className="tab-content stack" style={{ gap: '1.5rem' }}>
          {/* Summary Metric Cards */}
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <div className="stat-card">
              <div className="stat-card-label">Total Completed Requests</div>
              <div className="stat-card-value">{archiveData?.stats?.total_fulfilled || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Total Units Sourced</div>
              <div className="stat-card-value" style={{ color: 'var(--primary)' }}>
                {archiveData?.stats?.total_units_received || 0} Bags
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Fulfillment Success Rate</div>
              <div className="stat-card-value" style={{ color: '#15803d' }}>
                {archiveData?.stats?.fulfillment_rate_percent || 0}%
              </div>
            </div>
          </div>

          <div className="form-card">
            <h3 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.75rem' }}>
              Past Requests &amp; Fulfillment Archive
            </h3>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Case Reference</th>
                    <th>Blood Group &amp; Units</th>
                    <th>Hospital / Facility</th>
                    <th>Date Requested</th>
                    <th>Final Status</th>
                  </tr>
                </thead>
                <tbody>
                  {archiveData?.archive?.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem 1rem' }}>
                        No archived requests yet. Completed or cancelled requests will be recorded here.
                      </td>
                    </tr>
                  ) : (
                    archiveData.archive.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.patient_case || `Request #${r.id}`}</strong>
                          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                            Attendant: {r.attendant_name || 'Family Attendant'}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-red">{r.blood_group} &bull; {r.units_needed} Unit(s)</span>
                        </td>
                        <td>{r.hospital_name}, {r.city}</td>
                        <td>{formatDate(r.created_at)}</td>
                        <td>
                          <span className={`badge ${r.status === 'fulfilled' ? 'badge-teal' : 'badge-neutral'}`}>
                            {humanizeStatus(r.status)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
