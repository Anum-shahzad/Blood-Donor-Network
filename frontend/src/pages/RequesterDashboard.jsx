import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiUpload } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import VerificationBadge from '../components/VerificationBadge.jsx';
import Autocomplete from '../components/Autocomplete.jsx';
import ReportProblemModal from '../components/ReportProblemModal.jsx';
import useRequesterNotifications from '../lib/useRequesterNotifications.js';
import RequestEvidencePanel, { checkEvidenceFiles, DEFAULT_EVIDENCE_LIMITS } from '../components/RequestEvidencePanel.jsx';
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
import { formatDateTime, formatDate, humanizeStatus, localInputToIso, nowForLocalInput, formatLocalInputClear } from '../lib/format.js';
import { suggestHospitals, suggestDiagnoses, hasHospitalsForCity } from '../lib/suggestions.js';

const REFRESH_MS = 25 * 1000;

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];
const CLOSED_STATUSES = ['fulfilled', 'cancelled', 'expired'];

const emptyForm = {
  blood_group: '',
  units_needed: 1,
  hospital_name: '',
  city: '',
  urgency: 'high',
  required_by: '',
  patient_case: '',
  contact_phone: '',
  attendant_name: '',
  latitude: '',
  longitude: '',
};

function stateClassFor(request) {
  if (CLOSED_STATUSES.includes(request.status)) return 'state-closed';
  if (request.is_verified) return 'state-verified';
  if (request.urgency === 'critical') return 'state-critical';
  return 'state-pending';
}

// Status text that reflects unit progress: a live request with some units
// donated is "Partially fulfilled"; one with donors committed says so.
function requestStatusLabel(request) {
  if (!CLOSED_STATUSES.includes(request.status) && request.status !== 'pending') {
    const donated = Number(request.units_donated) || 0;
    const required = Number(request.units_required ?? request.units_needed) || 0;
    if (donated > 0 && donated < required) return 'Partially fulfilled';
    if (request.status === 'donor_accepted') return 'Donors committed';
  }
  return humanizeStatus(request.status);
}

// What the requester sees for a donor's live progress. DONATION_COMPLETED is the
// stored name of "Donation Claimed": the donor says they donated, and it only
// counts once the requester confirms it.
const DONOR_PROGRESS_STEPS = [
  { key: 'COMMITTED', label: 'Committed' },
  { key: 'EN_ROUTE', label: 'En route' },
  { key: 'ARRIVED', label: 'Arrived' },
];
function donorProgressIndex(state) {
  if (state === 'DONATING' || state === 'DONATION_COMPLETED') return 3;
  const i = DONOR_PROGRESS_STEPS.findIndex((s) => s.key === state);
  return i === -1 ? 0 : i;
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
  const activeTab = searchParams.get('tab') || 'tab-home';

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
  const [locating, setLocating] = useState(false);
  const [openChats, setOpenChats] = useState({});
  // Hospital evidence: latest status per request, and the files chosen on the
  // "post request" form. Evidence is mandatory: it is sent together with the
  // request in a single upload, and the server refuses a request without it.
  const [evidenceByRequest, setEvidenceByRequest] = useState({});
  const [evidenceLimits, setEvidenceLimits] = useState(null);
  const [newEvidenceFiles, setNewEvidenceFiles] = useState([]);
  const [newEvidenceKey, setNewEvidenceKey] = useState(0);
  const [evidenceError, setEvidenceError] = useState('');
  const [claimActing, setClaimActing] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  // Donor progress / donation-claim notices (same notification system as donor alerts).
  const notif = useRequesterNotifications({ userId: user?.id, onNew: () => loadRequests() });

  useEffect(() => {
    loadRequests();
    loadArchive();
    loadEvidence();
    const t = setInterval(() => {
      if (!document.hidden) {
        loadRequests();
        loadArchive();
        loadEvidence();
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

  function loadEvidence() {
    apiGet('/api/request-evidence/mine')
      .then((data) => {
        const map = {};
        (data?.evidence || []).forEach((e) => {
          map[e.request_id] = e;
        });
        setEvidenceByRequest(map);
        if (data?.limits) setEvidenceLimits(data.limits);
      })
      .catch(() => {});
  }

  function handleEvidenceChanged(message) {
    setError('');
    setSuccessMsg(message);
    loadEvidence();
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

  async function confirmClaim(requestId, donorId, donorName) {
    setError('');
    if (!window.confirm(`Confirm that you received ${donorName}'s blood donation? Only confirm if it really happened. This counts the units and cannot be undone.`)) return;
    setClaimActing(`${requestId}:${donorId}`);
    try {
      const res = await apiPost(`/api/requests/${requestId}/commitments/${donorId}/confirm`, {});
      setSuccessMsg(res.request_status === 'fulfilled'
        ? `Donation confirmed. Request #${requestId} is now fulfilled.`
        : `Donation confirmed. ${res.units_remaining} unit(s) still needed on request #${requestId}.`);
      setOpenChats((c) => ({ ...c, [`${requestId}:${donorId}`]: false }));
      loadRequests();
      loadArchive();
      notif.refresh();
    } catch (err) {
      setError(err.message);
      loadRequests();
    } finally {
      setClaimActing(null);
    }
  }

  async function disputeClaim(requestId, donorId, donorName) {
    setError('');
    if (!window.confirm(`Mark ${donorName}'s donation as Did Not Happen? It will not be counted. You can then report a problem to the administrators.`)) return;
    setClaimActing(`${requestId}:${donorId}`);
    try {
      await apiPost(`/api/requests/${requestId}/commitments/${donorId}/dispute`, {});
      setSuccessMsg(`${donorName}'s claim was marked as not having happened and was not counted. Those units are open to other donors again. Use Report a Problem if something was wrong.`);
      setOpenChats((c) => ({ ...c, [`${requestId}:${donorId}`]: false }));
      loadRequests();
      notif.refresh();
    } catch (err) {
      setError(err.message);
      loadRequests();
    } finally {
      setClaimActing(null);
    }
  }

  async function markDonorUnsuccessful(requestId, donorId, donorName) {
    setError('');
    if (!window.confirm(`Mark ${donorName}'s donation as unsuccessful? Their committed units will be opened up for other donors again.`)) return;
    try {
      await apiPost(`/api/requests/${requestId}/commitments/${donorId}/unsuccessful`, {});
      setSuccessMsg(`${donorName}'s donation was marked unsuccessful. Those units are open to other donors again.`);
      setOpenChats((c) => ({ ...c, [`${requestId}:${donorId}`]: false }));
      loadRequests();
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

  // Autocomplete suggestions: hospitals follow the selected city.
  const hospitalSuggestions = useMemo(
    () => suggestHospitals(form.city, form.hospital_name),
    [form.city, form.hospital_name]
  );
  const diagnosisSuggestions = useMemo(
    () => suggestDiagnoses(form.patient_case),
    [form.patient_case]
  );
  const hospitalEmptyMessage = !form.city.trim()
    ? 'Enter a city to see hospital suggestions.'
    : !hasHospitalsForCity(form.city)
      ? `No hospital suggestions for ${form.city.trim()}. You can type the hospital name.`
      : `No matching hospitals in ${form.city.trim()}. You can type the name manually.`;

  // Optional: pin the hospital's exact location (use it only while at the
  // hospital). Without it, donors' distance is measured to the city centre.
  function pinHospitalLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot share your location. The city will be used for distance instead.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: Math.round(pos.coords.latitude * 100000) / 100000,
          longitude: Math.round(pos.coords.longitude * 100000) / 100000,
        }));
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError('Could not read your location. Allow location access, or leave it out and the city will be used.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setEvidenceError('');
    setSuccessMsg('');

    // Supporting evidence is mandatory. The server enforces this on its own
    // (a request without valid evidence is refused whatever the browser does);
    // these checks only give an immediate, clear message before anything is sent.
    if (newEvidenceFiles.length === 0) {
      setEvidenceError('Supporting evidence is required. Attach at least one document (for example a hospital slip or letter) before submitting your request.');
      return;
    }
    const fileProblem = checkEvidenceFiles(newEvidenceFiles, evidenceLimits || DEFAULT_EVIDENCE_LIMITS);
    if (fileProblem) {
      setEvidenceError(`${fileProblem} Choose a different file.`);
      return;
    }

    setSubmitting(true);
    try {
      // One multipart request: the request's fields plus its evidence files.
      // The server stores both together or neither.
      const payload = {
        ...form,
        units_needed: Number(form.units_needed),
        required_by: localInputToIso(form.required_by),
      };
      const body = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) body.append(key, String(value));
      });
      newEvidenceFiles.forEach((file) => body.append('documents', file));

      const res = await apiUpload('/api/requests', body);
      setForm(emptyForm);
      setNewEvidenceFiles([]);
      setNewEvidenceKey((k) => k + 1);

      loadRequests();
      loadEvidence();
      // setTab clears the banners, so the message is set after it.
      setTab('tab-active');
      setSuccessMsg(`Emergency request #${res.id} created successfully with your supporting evidence! Admin verification queue has been notified.`);
    } catch (err) {
      setError(err.message);
      // The form is long; bring the message into view.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  if (!user) return null;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
  const activeRequests = requests.filter((r) => !CLOSED_STATUSES.includes(r.status));
  const fulfilledCount = archiveData?.stats?.total_fulfilled ?? requests.filter((r) => r.status === 'fulfilled').length;
  const criticalCount = activeRequests.filter((r) => r.urgency === 'critical').length;
  const totalUnitsSourced = archiveData?.stats?.total_units_received || 0;
  const pendingClaimCount = requests.reduce(
    (n, r) => n + (r.commitments || []).filter((c) => c.status === 'claimed').length,
    0
  );

  return (
    <DashboardLayout user={user} onLogout={handleLogout}>
      {/* Top Header */}
      <div className="dashboard-header">
        <h1>Hi, {firstName}</h1>
        <p className="dashboard-subtext">
          Here&apos;s a quick look at your blood requests today.
        </p>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {successMsg && (
        <div className="badge badge-teal" style={{ display: 'block', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
          {successMsg}
        </div>
      )}

      {pendingClaimCount > 0 && (
        <div className="badge badge-amber" style={{ display: 'block', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
          <AlertCircleIcon size={14} /> {pendingClaimCount} donation{pendingClaimCount === 1 ? ' is' : 's are'} waiting for your confirmation. Open{' '}
          <button type="button" onClick={() => setTab('tab-active')} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}>
            My Requests
          </button>{' '}
          to confirm or report that it did not happen.
        </div>
      )}

      {notif.items.length > 0 && (
        <div className="stack" style={{ gap: '0.5rem', marginBottom: '1rem' }} role="status" aria-live="polite">
          {notif.items.map((n) => (
            <div key={n.id} className="form-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.9rem', borderLeft: `4px solid ${n.needs_action ? 'var(--amber)' : 'var(--primary)'}` }}>
              <div style={{ flex: 1, fontSize: '0.88rem' }}>
                <strong style={{ display: 'block' }}>{n.title}</strong>
                <span style={{ color: 'var(--ink-muted)' }}>Request #{n.request_id} &middot; {n.body}</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>{formatDateTime(n.created_at)}</span>
              <button type="button" onClick={() => notif.dismiss(n.id)} className="btn btn-text" style={{ fontSize: '0.8rem' }}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ================================================================= */}
      {/* HOME: QUICK OVERVIEW                                             */}
      {/* ================================================================= */}
      {activeTab === 'tab-home' && (
        <div className="tab-content stack" style={{ gap: '1.5rem' }}>
          <div className="stat-grid" style={{ marginBottom: 0 }}>
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

          <div className="form-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Your active requests</h3>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                  Most recent requests still waiting to be fulfilled
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {activeRequests.length > 0 && (
                  <button onClick={() => setTab('tab-active')} className="btn btn-secondary" style={{ fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}>
                    View all ({activeRequests.length})
                  </button>
                )}
                <button onClick={() => setTab('tab-post')} className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}>
                  + Post Emergency
                </button>
              </div>
            </div>

            {activeRequests.length === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>
                You have no open requests. Post one whenever blood is needed.
              </p>
            ) : (
              <div className="stack" style={{ gap: '0.6rem' }}>
                {activeRequests.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.9rem' }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: 'var(--primary)', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {r.blood_group}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '0.92rem' }}>{r.patient_case || `Emergency Request #${r.id}`}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                        {r.hospital_name}{r.city ? `, ${r.city}` : ''} &middot; {r.units_donated ?? 0}/{r.units_needed} unit{r.units_needed > 1 ? 's' : ''} donated &middot; {r.matched_donors_count || 0} nearby donors
                      </span>
                    </div>
                    <span className={`badge ${r.is_verified ? 'badge-teal' : 'badge-amber'}`}>
                      {r.is_verified ? 'Verified' : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
                          {r.hospital_name}, {r.city} &bull; {r.units_required ?? r.units_needed} Unit(s) Required
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
                      <strong>{requestStatusLabel(r)}</strong>
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

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                      gap: '0.75rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.65rem 0.85rem',
                      margin: '0 0 0.75rem',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>REQUIRED</span>
                      <strong>{r.units_required ?? r.units_needed}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>DONATED</span>
                      <strong style={{ color: '#15803d' }}>{r.units_donated ?? 0}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>COMMITTED (NOT YET DONATED)</span>
                      <strong style={{ color: 'var(--amber)' }}>{r.units_committed ?? 0}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' }}>REMAINING</span>
                      <strong style={{ color: 'var(--primary)' }}>{r.units_remaining ?? r.units_needed}</strong>
                    </div>
                  </div>

                  {(r.commitments || []).length > 0 && (
                    <div className="stack" style={{ gap: '0.45rem', margin: '0 0 0.75rem' }}>
                      {r.commitments.map((c) => {
                        const key = `${r.id}:${c.donor_id}`;
                        const isLive = c.status === 'accepted' || c.status === 'claimed';
                        const progressIdx = donorProgressIndex(c.donor_state);
                        const acting = claimActing === key;
                        return (
                          <div
                            key={c.donor_id}
                            style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', fontSize: '0.84rem' }}
                          >
                            <strong style={{ flex: 1, minWidth: 120 }}>{c.donor_name}</strong>
                            <span className={`badge ${c.status === 'donated' ? 'badge-teal' : c.status === 'claimed' ? 'badge-red' : c.status === 'failed' || c.status === 'disputed' ? 'badge-neutral' : 'badge-amber'}`}>
                              {c.status === 'donated'
                                ? `Donated ${c.confirmed_units} unit(s)`
                                : c.status === 'failed'
                                  ? 'Donation unsuccessful'
                                  : c.status === 'disputed'
                                    ? 'Did not happen \u2014 not counted'
                                    : c.status === 'claimed'
                                      ? `Claims to have donated ${c.claim?.units ?? c.committed_units} unit(s) \u2014 awaiting your confirmation`
                                      : `Committed ${c.committed_units} unit(s) \u2014 not yet donated`}
                            </span>

                            {isLive && (
                              <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }} aria-label="Donor progress">
                                {DONOR_PROGRESS_STEPS.map((step, i) => (
                                  <span
                                    key={step.key}
                                    className={`badge ${c.status === 'claimed' || i < progressIdx ? 'badge-teal' : i === progressIdx ? 'badge-amber' : 'badge-neutral'}`}
                                    style={{ fontSize: '0.74rem' }}
                                  >
                                    {c.status === 'claimed' || i < progressIdx ? '\u2713 ' : ''}{step.label}
                                  </span>
                                ))}
                                <span className={`badge ${c.status === 'claimed' ? 'badge-red' : 'badge-neutral'}`} style={{ fontSize: '0.74rem' }}>
                                  Donation claimed
                                </span>
                                {c.donor_state_changed_at && (
                                  <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
                                    updated {formatDateTime(c.donor_state_changed_at)}
                                  </span>
                                )}
                              </div>
                            )}

                            {c.status === 'claimed' && (
                              <div style={{ flexBasis: '100%', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem' }}>
                                <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem' }}>
                                  {c.donor_name} says they donated
                                  {c.claim?.hospital_name ? ` at ${c.claim.hospital_name}` : ''}
                                  {c.claim?.donation_date ? ` on ${formatDate(c.claim.donation_date)}` : ''}.
                                  This does not count until you confirm it.
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  <button
                                    onClick={() => confirmClaim(r.id, c.donor_id, c.donor_name)}
                                    disabled={acting}
                                    className="btn btn-primary"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                                  >
                                    {acting ? 'Saving...' : 'Confirm Received'}
                                  </button>
                                  <button
                                    onClick={() => disputeClaim(r.id, c.donor_id, c.donor_name)}
                                    disabled={acting}
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                                  >
                                    Did Not Happen
                                  </button>
                                </div>
                              </div>
                            )}

                            {c.status === 'disputed' && !c.reported && (
                              <p style={{ flexBasis: '100%', margin: 0, fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                                This claim was not counted. If something was wrong, report it so an administrator can look into it.
                              </p>
                            )}

                            {isLive && (
                              <button
                                onClick={() => toggleChat(key)}
                                className="btn btn-secondary"
                                style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                              >
                                {openChats[key] ? 'Hide Chat' : 'Chat'}
                              </button>
                            )}
                            {c.status === 'accepted' && (
                              <button
                                onClick={() => markDonorUnsuccessful(r.id, c.donor_id, c.donor_name)}
                                className="btn btn-text"
                                style={{ fontSize: '0.8rem', color: 'var(--primary)' }}
                              >
                                Mark unsuccessful
                              </button>
                            )}
                            {c.status !== 'donated' && (
                              c.reported ? (
                                <span className="badge badge-neutral" style={{ fontSize: '0.74rem' }}>Problem reported</span>
                              ) : (
                                <button
                                  onClick={() => setReportTarget({ requestId: r.id, donorId: c.donor_id, donorName: c.donor_name })}
                                  className="btn btn-text"
                                  style={{ fontSize: '0.8rem', color: 'var(--primary)' }}
                                >
                                  Report a Problem
                                </button>
                              )
                            )}
                            {isLive && openChats[key] && (
                              <div style={{ flexBasis: '100%', marginTop: '0.4rem' }}>
                                <ChatPanel
                                  requestId={r.id}
                                  donorId={c.donor_id}
                                  currentUserId={user.id}
                                  onClose={() => toggleChat(key)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <RequestEvidencePanel
                    requestId={r.id}
                    evidence={evidenceByRequest[r.id]}
                    limits={evidenceLimits}
                    onChanged={handleEvidenceChanged}
                  />

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

                    <button
                      onClick={() => updateStatus(r.id, 'fulfilled')}
                      disabled={(r.units_donated ?? 0) < (r.units_required ?? r.units_needed)}
                      title={(r.units_donated ?? 0) < (r.units_required ?? r.units_needed) ? 'Available once all required units have a confirmed donation' : ''}
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
              Emergency requests immediately alert compatible, identity-verified donors near the hospital.
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
                  Hospital / Center
                  <Autocomplete
                    ariaLabel="Hospital / Center"
                    placeholder="e.g. City General Hospital"
                    value={form.hospital_name}
                    onChange={(v) => setForm((f) => ({ ...f, hospital_name: v }))}
                    items={hospitalSuggestions}
                    emptyMessage={hospitalEmptyMessage}
                    required
                  />
                </label>

                <label className="field">
                  City
                  <input
                    type="text"
                    placeholder="e.g. Karachi"
                    value={form.city}
                    onChange={update('city')}
                    required
                  />
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '-0.25rem' }}>
                {form.latitude === '' ? (
                  <button type="button" className="btn btn-secondary" onClick={pinHospitalLocation} disabled={locating}>
                    {locating ? 'Locating…' : 'Pin hospital location (I am at the hospital)'}
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>Hospital location pinned.</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setForm((f) => ({ ...f, latitude: '', longitude: '' }))}
                    >
                      Remove pin
                    </button>
                  </>
                )}
                <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                  Optional. Donors only see requests within their chosen distance; pinning makes that exact instead of city-level.
                </span>
              </div>

              <label className="field">
                Patient Medical Case / Diagnosis
                <Autocomplete
                  ariaLabel="Patient Medical Case / Diagnosis"
                  placeholder="e.g. Emergency C-Section, Thalassemia Major Child, Trauma Ward"
                  value={form.patient_case}
                  onChange={(v) => setForm((f) => ({ ...f, patient_case: v }))}
                  items={diagnosisSuggestions}
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
                      {level === 'critical' ? 'Critical' : level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low'}
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
                <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', fontWeight: 400 }}>
                  Format: 16 Oct 2026
                  {form.required_by && <> &middot; Selected: {formatLocalInputClear(form.required_by)}</>}
                </span>
              </label>

              <label className="field">
                Hospital Document / Evidence (Required)
                <input
                  key={`new-evidence-${newEvidenceKey}`}
                  type="file"
                  multiple
                  aria-required="true"
                  aria-invalid={evidenceError ? 'true' : undefined}
                  accept={(evidenceLimits || DEFAULT_EVIDENCE_LIMITS).allowed_types.join(',')}
                  onChange={(e) => {
                    setNewEvidenceFiles(Array.from(e.target.files || []));
                    setEvidenceError('');
                  }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', fontWeight: 400 }}>
                  Required. Attach a hospital slip, letter or similar document so an admin can verify your request.
                  Upload up to {(evidenceLimits || DEFAULT_EVIDENCE_LIMITS).max_files} files (JPEG, PNG, WebP or PDF;
                  maximum 5 MB each). Only you and authorized admins can access these documents.
                </span>
              </label>
              {evidenceError && (
                <p className="error-banner" role="alert" style={{ marginTop: '0.5rem' }}>{evidenceError}</p>
              )}

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
                Ranked by blood compatibility, geographical proximity, and post-donation recency.
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

          {radarLoading && <p className="empty-state">Scanning the donor network for compatible matches...</p>}
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
                    No currently available donors matching this request nearby.
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
                          <MapPinIcon size={14} /> {m.city || '—'}
                          <VerificationBadge verification={m.verification} style={{ marginLeft: 'auto' }} />
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
      {reportTarget && (
        <ReportProblemModal
          role="requester"
          requestId={reportTarget.requestId}
          donorId={reportTarget.donorId}
          subject={`About ${reportTarget.donorName} on request #${reportTarget.requestId}`}
          onClose={() => setReportTarget(null)}
          onDone={(message) => { setReportTarget(null); setError(''); setSuccessMsg(message); loadRequests(); }}
        />
      )}
    </DashboardLayout>
  );
}
