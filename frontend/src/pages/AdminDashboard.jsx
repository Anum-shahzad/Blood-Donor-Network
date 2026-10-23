import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPatch } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';
import AdminVerificationPanel from '../components/AdminVerificationPanel.jsx';
import VerificationBadge from '../components/VerificationBadge.jsx';
import AdminRequestEvidence from '../components/AdminRequestEvidence.jsx';
import {
  GaugeIcon,
  ShieldCheckIcon,
  UsersIcon,
  AlertCircleIcon,
  SlidersIcon,
  HospitalIcon,
  CheckCircleIcon,
  DropletIcon,
  MapPinIcon,
  ClockIcon,
  PhoneIcon,
} from '../components/icons.jsx';
import { formatDateTime, formatDate, humanizeStatus } from '../lib/format.js';

const REFRESH_MS = 25 * 1000;

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user = getUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'tab-home';

  const [analytics, setAnalytics] = useState(null);
  const [requests, setRequests] = useState([]);
  // Request evidence, keyed by request id (latest submission each).
  const [evidenceByRequest, setEvidenceByRequest] = useState({});
  const [donors, setDonors] = useState([]);
  const [fraudData, setFraudData] = useState({ reports: [], rate_limit_flags: [] });
  const [reportEvents, setReportEvents] = useState({});

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [donorSearch, setDonorSearch] = useState('');

  useEffect(() => {
    loadAll();
    const t = setInterval(() => {
      if (!document.hidden) loadAll();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  function setTab(tabId) {
    setSearchParams({ tab: tabId });
    setError('');
    setSuccessMsg('');
  }

  function loadAll() {
    loadAnalytics();
    loadRequests();
    loadEvidence();
    loadDonors();
    loadFraudReports();
  }

  function loadAnalytics() {
    apiGet('/api/admin/analytics')
      .then(setAnalytics)
      .catch((err) => setError(err.message));
  }

  function loadRequests() {
    apiGet('/api/admin/requests')
      .then(setRequests)
      .catch((err) => setError(err.message));
  }

  function loadEvidence() {
    apiGet('/api/admin/request-evidence')
      .then((data) => {
        const map = {};
        (data?.evidence || []).forEach((e) => {
          map[e.request_id] = e;
        });
        setEvidenceByRequest(map);
      })
      .catch(() => {});
  }

  function loadDonors() {
    apiGet('/api/admin/donors')
      .then(setDonors)
      .catch((err) => setError(err.message));
  }

  function loadFraudReports() {
    apiGet('/api/admin/fraud-reports')
      .then((data) => setFraudData(data || { reports: [], rate_limit_flags: [] }))
      .catch(() => {});
  }

  async function verifyRequest(id, verified) {
    setError('');
    setSuccessMsg('');
    try {
      await apiPatch(`/api/admin/requests/${id}/verify`, { verified });
      setSuccessMsg(`Request #${id} verification set to: ${verified ? 'Verified' : 'Unverified'}`);
      loadRequests();
      loadAnalytics();
    } catch (err) {
      setError(err.message);
    }
  }

  async function rejectRequest(id) {
    if (!window.confirm(`Reject and cancel request #${id}? This marks it fraudulent or unverified.`)) return;
    setError('');
    setSuccessMsg('');
    try {
      await apiPatch(`/api/admin/requests/${id}/reject`, {});
      setSuccessMsg(`Request #${id} has been rejected and cancelled.`);
      loadRequests();
      loadAnalytics();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateReportStatus(reportId, status) {
    setError('');
    setSuccessMsg('');
    // The note goes into the report's audit trail with the admin's name.
    const note = window.prompt(`Note for the audit trail (optional) \u2014 marking report #${reportId} as ${status}:`, '');
    if (note === null) return;
    try {
      await apiPatch(`/api/admin/fraud-reports/${reportId}`, { status, note });
      setSuccessMsg(`Report #${reportId} updated to ${status}.`);
      loadFraudReports();
      setReportEvents((m) => { const { [reportId]: _gone, ...rest } = m; return rest; });
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleReportHistory(reportId) {
    if (reportEvents[reportId]) {
      setReportEvents((m) => { const { [reportId]: _gone, ...rest } = m; return rest; });
      return;
    }
    try {
      const data = await apiGet(`/api/admin/fraud-reports/${reportId}/events`);
      setReportEvents((m) => ({ ...m, [reportId]: data.events || [] }));
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    clearSession();
    navigate('/login');
  }

  const filteredDonors = useMemo(() => {
    if (!donorSearch.trim()) return donors;
    const q = donorSearch.toLowerCase();
    return donors.filter(
      (d) =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.email || '').toLowerCase().includes(q) ||
        (d.city || '').toLowerCase().includes(q) ||
        (d.blood_group || '').toLowerCase().includes(q)
    );
  }, [donors, donorSearch]);

  if (!user) return null;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
  const pendingRequestsCount = requests.filter((r) => !r.is_verified).length;
  const pendingDonorsCount = donors.filter((d) => !d.verification?.identity_verified).length;
  // Evidence waiting for a decision on a request that is still live; evidence
  // on a closed request can no longer be reviewed, so it is not counted.
  const pendingEvidenceCount = requests.filter(
    (r) =>
      ['pending', 'verified', 'matched', 'donor_accepted'].includes(r.status) &&
      evidenceByRequest[r.id]?.status === 'pending'
  ).length;

  return (
    <DashboardLayout user={user} onLogout={handleLogout}>
      {/* Top Header */}
      <div className="dashboard-header">
        <h1>Hi, {firstName}</h1>
        <p className="dashboard-subtext">
          Here&apos;s what needs your attention across the network today.
        </p>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {successMsg && (
        <div className="badge badge-teal" style={{ display: 'block', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
          {successMsg}
        </div>
      )}

      {/* ================================================================= */}
      {/* HOME: QUICK OVERVIEW                                             */}
      {/* ================================================================= */}
      {activeTab === 'tab-home' && (
        <div className="tab-content stack" style={{ gap: '1.5rem' }}>
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <div className="stat-card">
              <div className="stat-card-label">Total Requests</div>
              <div className="stat-card-value">{requests.length}</div>
            </div>
            <div className="stat-card stat-card--accent">
              <div className="stat-card-label">Pending Verification</div>
              <div className="stat-card-value">{pendingRequestsCount}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Registered Donors</div>
              <div className="stat-card-value">{donors.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Identity Not Verified</div>
              <div className="stat-card-value">{pendingDonorsCount}</div>
            </div>
          </div>

          <div className="form-card">
            <h3 style={{ margin: '0 0 0.85rem', fontSize: '1.05rem' }}>Needs your attention</h3>
            <div className="stack" style={{ gap: '0.6rem' }}>
              {[
                { label: 'Requests awaiting verification', count: pendingRequestsCount, tab: 'tab-verifications' },
                { label: 'Request evidence awaiting review', count: pendingEvidenceCount, tab: 'tab-verifications' },
                { label: 'Rate-limit flags to review', count: fraudData?.rate_limit_flags?.length || 0, tab: 'tab-fraud' },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.85rem', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.9rem' }}
                >
                  <span style={{ fontSize: '0.92rem' }}>
                    <strong style={{ marginRight: '0.5rem', color: item.count > 0 ? 'var(--primary)' : 'var(--ink-muted)' }}>{item.count}</strong>
                    {item.label}
                  </span>
                  {item.count > 0 && (
                    <button onClick={() => setTab(item.tab)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>
                      Review
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1: NETWORK ANALYTICS                                         */}
      {/* ================================================================= */}
      {activeTab === 'tab-analytics' && (
        <div className="tab-content stack" style={{ gap: '1.5rem' }}>
          {/* Key Metrics Grid */}
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <div className="stat-card">
              <div className="stat-card-label">Active Emergencies</div>
              <div className="stat-card-value" style={{ color: 'var(--primary)' }}>
                {analytics?.summary?.active_requests || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Available Active Donors</div>
              <div className="stat-card-value" style={{ color: '#15803d' }}>
                {analytics?.summary?.available_donors || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Fulfillment Rate</div>
              <div className="stat-card-value">{analytics?.summary?.fulfillment_rate_percent || 0}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Donors in Cooldown</div>
              <div className="stat-card-value" style={{ color: 'var(--amber)' }}>
                {analytics?.summary?.in_cooldown_donors || 0}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
            {/* Blood Group Balance Table */}
            <div className="form-card">
              <h3 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.4rem' }}>
                Blood Group Supply vs. Demand Matrix
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-muted)', marginBottom: '0.75rem' }}>
                Compares units needed for active requests against available registered donors
              </p>

              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Blood Group</th>
                      <th>Units Demanded</th>
                      <th>Available Donors</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics?.blood_group_balance?.map((b) => {
                      const shortage = Number(b.units_needed) > Number(b.available_donors);
                      return (
                        <tr key={b.blood_group}>
                          <td><strong className="badge badge-red">{b.blood_group}</strong></td>
                          <td>{b.units_needed} Bags</td>
                          <td><strong>{b.available_donors} Donors</strong></td>
                          <td>
                            <span className={`badge ${shortage ? 'badge-red' : 'badge-teal'}`}>
                              {shortage ? 'Shortage Alert' : 'Balanced'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Area Distribution */}
            <div className="form-card">
              <h3 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.4rem' }}>
                Area Breakdown
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-muted)', marginBottom: '0.75rem' }}>
                Emergency volume by hospital and administrative sectors
              </p>

              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Area / District</th>
                      <th>Total Requests</th>
                      <th>Fulfilled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics?.area_distribution?.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '1.5rem' }}>
                          No location data recorded yet.
                        </td>
                      </tr>
                    ) : (
                      analytics?.area_distribution?.map((a, i) => (
                        <tr key={i}>
                          <td><strong>{a.area}</strong></td>
                          <td>{a.total_requests} Requests</td>
                          <td>
                            <span className="badge badge-teal">{a.fulfilled_count || 0} Completed</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: REQUEST VERIFICATION QUEUE                                */}
      {/* ================================================================= */}
      {activeTab === 'tab-verifications' && (
        <div className="tab-content stack" style={{ gap: '1.25rem' }}>
          <div className="form-card" style={{ padding: '1rem 1.25rem' }}>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--ink)' }}>
              Verifying confirms that a hospital slip, prescription, or medical attendant confirms this emergency. Unverified requests are ordered first.
            </p>
          </div>

          {requests.length === 0 ? (
            <p className="empty-state">No requests in the system.</p>
          ) : (
            requests.map((r) => (
              <div
                key={r.id}
                className={`record-card ${r.is_verified ? 'state-verified' : 'state-unverified'}`}
              >
                <div className="record-title" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--primary)',
                        color: '#fff',
                        fontWeight: 900,
                        fontSize: '1.15rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {r.blood_group}
                    </div>
                    <div>
                      <strong style={{ fontSize: '1rem', display: 'block' }}>
                        {r.patient_case || `Emergency Request #${r.id}`} &mdash; {r.units_needed} Bag(s)
                      </strong>
                      <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                        {r.hospital_name}, {r.city} &bull; Attendant: {r.attendant_name || r.requester_name}
                      </span>
                    </div>
                  </div>

                  <span className={`badge ${r.is_verified ? 'badge-teal' : 'badge-red'}`}>
                    {r.is_verified ? 'Verified Request' : 'Verification Required'}
                  </span>
                </div>

                <div
                  style={{
                    background: 'var(--paper)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.65rem 0.85rem',
                    margin: '0.75rem 0',
                    fontSize: '0.82rem',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '0.5rem',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>REQUESTER CONTACT</span>
                    <span>{r.requester_email} {r.contact_phone ? `· ${r.contact_phone}` : ''}</span>
                  </div>
                  {/* Older requests only: the slip-reference field was removed from the form. */}
                  {r.prescription_slip && (
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>PRESCRIPTION / SLIP NOTE</span>
                      <strong>{r.prescription_slip}</strong>
                    </div>
                  )}
                  <div>
                    <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>URGENCY &amp; STATUS</span>
                    <span>{r.urgency.toUpperCase()} &bull; {humanizeStatus(r.status)}</span>
                  </div>
                </div>

                <AdminRequestEvidence
                  request={r}
                  evidence={evidenceByRequest[r.id]}
                  onDone={(message) => {
                    setError('');
                    setSuccessMsg(message);
                    loadEvidence();
                  }}
                  onError={(message) => {
                    setSuccessMsg('');
                    setError(message);
                    loadEvidence();
                  }}
                />

                <div className="record-actions">
                  <button
                    onClick={() => verifyRequest(r.id, !r.is_verified)}
                    disabled={!r.is_verified && evidenceByRequest[r.id]?.status !== 'approved'}
                    title={
                      !r.is_verified && evidenceByRequest[r.id]?.status !== 'approved'
                        ? 'Approve the supporting evidence before verifying this request'
                        : undefined
                    }
                    className="btn btn-secondary"
                    style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                  >
                    <ShieldCheckIcon size={14} /> {r.is_verified ? 'Revoke Verification' : 'Approve & Verify Request'}
                  </button>

                  <button
                    onClick={() => rejectRequest(r.id)}
                    className="btn btn-text"
                    style={{ fontSize: '0.82rem', color: 'var(--primary)', marginLeft: 'auto' }}
                  >
                    Reject / Cancel Suspicious Request
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: DONOR REGISTRY & COMPLIANCE                               */}
      {/* ================================================================= */}
      {activeTab === 'tab-donors' && (
        <div className="tab-content stack" style={{ gap: '1.25rem' }}>
          {/* Search Bar */}
          <div className="form-card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search donors by name, blood group, city, or email..."
              value={donorSearch}
              onChange={(e) => setDonorSearch(e.target.value)}
              style={{ flex: 1, padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)', fontSize: '0.88rem' }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
              {filteredDonors.length} Donors Listed
            </span>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Blood Group</th>
                  <th>City / Area</th>
                  <th>Status</th>
                  <th>Total Donations</th>
                </tr>
              </thead>
              <tbody>
                {filteredDonors.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem' }}>
                      No matching donors found in the registry.
                    </td>
                  </tr>
                ) : (
                  filteredDonors.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                          {d.email} {d.phone ? `· ${d.phone}` : ''}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-red">{d.blood_group || 'Unset'}</span>
                      </td>
                      <td>{d.city || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <span className={`badge ${d.is_available ? 'badge-teal' : 'badge-neutral'}`}>
                            {d.is_available ? 'Available' : 'Unavailable'}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                            {d.current_status || 'AVAILABLE'}
                          </span>
                          <VerificationBadge verification={d.verification} />
                        </div>
                      </td>
                      <td>{d.total_donations || (d.last_donation_date ? 1 : 0)} times</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: ABUSE & FRAUD REPORTS                                     */}
      {/* ================================================================= */}
      {activeTab === 'tab-fraud' && (
        <div className="tab-content stack" style={{ gap: '1.5rem' }}>
          {/* Rate-Limit Anomaly Scanner */}
          <div className="form-card">
            <h3 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.35rem' }}>
              Rate-Limit Velocity Monitoring (&gt;= 3 requests/day)
            </h3>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: '0.75rem' }}>
              Enforces the prototype policy of max 3 emergency requests per day per user/attendant to curb duplicate spam
            </p>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Requester Name</th>
                    <th>Contact Phone</th>
                    <th>Requests in 24 Hours</th>
                    <th>Safety Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fraudData?.rate_limit_flags?.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: '#15803d', padding: '1.5rem' }}>
                        All requester activity is within standard safe velocity thresholds.
                      </td>
                    </tr>
                  ) : (
                    fraudData.rate_limit_flags.map((flag) => (
                      <tr key={flag.user_id}>
                        <td><strong>{flag.name}</strong> ({flag.email})</td>
                        <td>{flag.phone || 'Protected'}</td>
                        <td><strong style={{ color: 'var(--primary)' }}>{flag.request_count_24h} Requests</strong></td>
                        <td>
                          <span className={`badge ${flag.request_count_24h >= 3 ? 'badge-red' : 'badge-amber'}`}>
                            {flag.request_count_24h >= 3 ? 'Rate-Limit Breached' : 'High Velocity Warning'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Submitted Abuse Reports */}
          <div className="form-card">
            <h3 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '0.35rem' }}>
              Abuse &amp; Suspicious Activity Queue
            </h3>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: '0.75rem' }}>
              User-reported anomalies, fake emergency claims, and unreachable donor declarations
            </p>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Details</th>
                    <th>Target</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {fraudData?.reports?.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '1.5rem' }}>
                        No pending fraud or abuse reports currently logged in the queue.
                      </td>
                    </tr>
                  ) : (
                    fraudData.reports.map((r) => (
                      <tr key={r.id}>
                        <td><span className="badge badge-amber">{r.report_type}</span></td>
                        <td style={{ whiteSpace: 'pre-wrap' }}>
                          {r.details}
                          {r.report_type === 'donation_dispute' && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                              Reporter: {r.reporter_name || 'unknown'}{r.reporter_role ? ` (${r.reporter_role})` : ''}
                              {' \u00b7 '}Request #{r.target_request_id}{r.request_hospital ? ` at ${r.request_hospital}` : ''}
                              {r.donor_name ? ` \u00b7 Donor: ${r.donor_name}` : ''}
                              {r.donor_response_status ? ` \u00b7 Donor response: ${r.donor_response_status}` : ''}
                              {r.claimed_at ? ` \u00b7 Claimed ${formatDate(r.claimed_at)}${r.claim_units ? ` (${r.claim_units} unit)` : ''}` : ''}
                              {r.donor_response_status === 'donated' ? ' \u00b7 Confirmed by requester' : r.claimed_at ? ' \u00b7 Not counted as a donation' : ''}
                            </div>
                          )}
                          {r.admin_note && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
                              Admin note{r.reviewed_by_name ? ` (${r.reviewed_by_name})` : ''}: {r.admin_note}
                            </div>
                          )}
                          {reportEvents[r.id] && (
                            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.76rem', color: 'var(--ink-muted)' }}>
                              {reportEvents[r.id].map((e) => (
                                <li key={e.id}>
                                  {formatDate(e.created_at)} &middot; {e.action === 'filed' ? 'Filed' : `${e.from_status} \u2192 ${e.to_status}`}
                                  {e.actor_name ? ` by ${e.actor_name}` : ''}{e.note && e.action !== 'filed' ? ` \u2014 ${e.note}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td>{r.target_user_name || r.request_hospital || 'Network entity'}</td>
                        <td>{formatDate(r.created_at)}</td>
                        <td><span className="badge badge-neutral">{r.status}</span></td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {r.status === 'pending' && (
                              <button
                                onClick={() => updateReportStatus(r.id, 'investigating')}
                                className="btn btn-secondary"
                                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                              >
                                Investigate
                              </button>
                            )}
                            {(r.status === 'pending' || r.status === 'investigating') && (
                              <>
                                <button
                                  onClick={() => updateReportStatus(r.id, 'resolved')}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                                >
                                  Resolve
                                </button>
                                <button
                                  onClick={() => updateReportStatus(r.id, 'dismissed')}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => toggleReportHistory(r.id)}
                              className="btn btn-text"
                              style={{ fontSize: '0.75rem' }}
                            >
                              {reportEvents[r.id] ? 'Hide History' : 'History'}
                            </button>
                          </div>
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

      {/* ================================================================= */}
      {/* ID & DONATION EVIDENCE REVIEW                                    */}
      {/* ================================================================= */}
      {activeTab === 'tab-id-review' && <AdminVerificationPanel />}
    </DashboardLayout>
  );
}
