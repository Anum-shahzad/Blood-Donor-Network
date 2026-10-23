import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, apiPut } from '../api/client.js';
import { getUser, clearSession } from '../auth/session.js';
import DashboardLayout from '../components/DashboardLayout.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import VerificationPanel from '../components/VerificationPanel.jsx';
import VerificationBadge from '../components/VerificationBadge.jsx';
import IdentityRequiredNotice from '../components/IdentityRequiredNotice.jsx';
import NotificationPopups from '../components/NotificationPopups.jsx';
import NotificationSettings from '../components/NotificationSettings.jsx';
import ReportProblemModal from '../components/ReportProblemModal.jsx';
import useDonorNotifications from '../lib/useDonorNotifications.js';
import { enableSound, disablePush, registerServiceWorker, soundState as readSoundState } from '../lib/notifications.js';
import {
  DropletIcon,
  MapPinIcon,
  ShieldCheckIcon,
  ClockIcon,
  HeartIcon,
  IdCardIcon,
  SlidersIcon,
  PhoneIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  CarIcon,
  HospitalIcon,
  XIcon,
} from '../components/icons.jsx';
import { formatDate, formatDateTime, todayForDateInput } from '../lib/format.js';
import { getCompatibleDonorGroups } from '../lib/bloodCompatibility.js';

const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const COOLDOWN_DAYS = 90;
const MATCH_REFRESH_MS = 25 * 1000;

// DONATION_COMPLETED is the stored name of "Donation Claimed": the donor said they
// donated and the commitment stays visible until the requester confirms it.
const COMMITMENT_STATES = ['COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED'];

function committedStateLabel(status) {
  if (!status) return 'Profile incomplete';
  const labels = {
    MATCHED: 'Matched — awaiting response',
    COMMITTED: 'Committed to emergency',
    EN_ROUTE: 'En route to hospital',
    ARRIVED: 'Arrived at hospital',
    DONATING: 'Donating',
    DONATION_COMPLETED: 'Donation claimed \u2014 awaiting requester confirmation',
    COOLDOWN: 'In post-donation cooldown',
  };
  return labels[status] || status;
}

const URGENCY_BADGE = {
  critical: 'badge-red',
  high: 'badge-red',
  medium: 'badge-amber',
  low: 'badge-neutral',
};

// Accepting a request needs an admin-approved identity: verification Level 3
// or higher, as derived by the server from the database. The server enforces
// this on every accept / commitment / donation endpoint; the UI only explains it.
function isIdentityVerified(profile) {
  return Number(profile?.verification?.level) >= 3;
}

// The server re-checks everything on accept; this only greys out the popup's
// Accept button when the donor obviously cannot accept right now.
function isEligibleForAlerts(profile) {
  if (!profile) return false;
  if (!isIdentityVerified(profile)) return false;
  if (profile.current_status && profile.current_status !== 'AVAILABLE') return false;
  return profile.cooldown_info ? profile.cooldown_info.isEligible : true;
}

export default function DonorDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'tab-home';

  const [profile, setProfile] = useState(null);
  const [matches, setMatches] = useState([]);
  const [matchesReason, setMatchesReason] = useState('');
  const [donations, setDonations] = useState([]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [toggling, setToggling] = useState(false);
  const [glow, setGlow] = useState(false);
  const [actingOn, setActingOn] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [reportingUnsuccessful, setReportingUnsuccessful] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [locating, setLocating] = useState(false);
  const [areaFilter, setAreaFilter] = useState('all');

  // Modal state
  const [logModalOpen, setLogModalOpen] = useState(false);
  // true = the modal is claiming a donation for the active commitment (needs the
  // requester's confirmation); false = logging a past donation made elsewhere.
  const [claimMode, setClaimMode] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [submittingDonation, setSubmittingDonation] = useState(false);
  const [logForm, setLogForm] = useState({
    donation_date: todayForDateInput(),
    hospital_name: '',
    recipient_case: '',
    units: 1,
  });

  // Settings form state
  const [settingsForm, setSettingsForm] = useState({
    phone_masked: true,
    alert_radius: 10,
    notify_inapp: true,
  });

  const [detailsForm, setDetailsForm] = useState({
    blood_group: '',
    last_donation_date: '',
  });

  const user = getUser();

  // Urgent-alert notifications (in-app popup + sound + browser notification).
  // The server decides what is eligible; this only displays what it returns.
  const [soundUi, setSoundUi] = useState(readSoundState());
  const notif = useDonorNotifications({ userId: user?.id, onNew: () => loadMatches() });
  const highlightId = Number(searchParams.get('request')) || null;
  const highlightedOnce = useRef(null);

  useEffect(() => {
    loadAll();
    // Registers the service worker (no permission prompt) so system and push
    // notifications can be shown and clicked.
    registerServiceWorker();
  }, []);

  // Opening a notification (?request=ID) scrolls to that request and flashes it.
  useEffect(() => {
    if (!highlightId || activeTab !== 'tab-feed' || highlightedOnce.current === highlightId) return;
    const el = document.getElementById(`request-${highlightId}`);
    if (!el) return;
    highlightedOnce.current = highlightId;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('request-highlight');
    const t = setTimeout(() => el.classList.remove('request-highlight'), 3600);
    return () => clearTimeout(t);
  }, [highlightId, activeTab, matches]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) loadMatches();
    }, MATCH_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  function setTab(tabId) {
    setSearchParams({ tab: tabId });
    setError('');
    setSuccessMsg('');
  }

  function loadAll() {
    apiGet('/api/donors/me')
      .then((data) => {
        setProfile(data);
        setDetailsForm({
          blood_group: data.blood_group || '',
          last_donation_date: data.last_donation_date || '',
        });
        setSettingsForm({
          phone_masked: Boolean(data.phone_masked),
          alert_radius: Number(data.alert_radius) || 10,
          notify_inapp: Boolean(data.notify_inapp),
        });
      })
      .catch((err) => setError(err.message));

    loadMatches();
    loadDonations();
  }

  function loadMatches() {
    apiGet('/api/donors/matches')
      .then((data) => {
        setMatches(data.matches || []);
        setMatchesReason(data.reason || '');
      })
      .catch((err) => setError(err.message));
  }

  function loadDonations() {
    apiGet('/api/donors/me/donations')
      .then((list) => setDonations(list || []))
      .catch(() => {});
  }

  async function toggleAvailability() {
    if (!profile || toggling) return;
    const next = !profile.is_available;
    // Flip instantly so the switch animates right away; roll back if the server says no.
    setProfile((p) => ({ ...p, is_available: next }));
    if (next) {
      setGlow(true);
      setTimeout(() => setGlow(false), 1000);
    }
    setToggling(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiPatch('/api/donors/me/availability', { is_available: next });
      loadMatches();
    } catch (err) {
      setProfile((p) => ({ ...p, is_available: !next }));
      setError(err.message);
    } finally {
      setToggling(false);
    }
  }

  async function respondTo(requestId, action) {
    setActingOn(requestId);
    setError('');
    setSuccessMsg('');
    try {
      await apiPost(`/api/requests/${requestId}/${action}`, {});
      if (action === 'accept') {
        setSuccessMsg(`You have accepted emergency request #${requestId}! Your commitment is active.`);
        setTab('tab-commitments');
      }
      loadAll();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setActingOn(null);
    }
  }

  // Popup actions. Accept goes through the normal accept endpoint, so every
  // server-side rule still applies; the notification is only marked
  // acknowledged once that succeeds.
  async function acceptFromNotification(n) {
    const ok = await respondTo(n.request_id, 'accept');
    if (ok) notif.acknowledge(n.id);
  }

  function viewFromNotification(n) {
    notif.acknowledge(n.id);
    highlightedOnce.current = null;
    setSearchParams({ tab: 'tab-feed', request: String(n.request_id) });
    loadMatches();
  }

  async function turnOnSoundFromPopup() {
    setSoundUi(await enableSound());
    notif.refresh();
  }

  async function cancelCommitment() {
    setCancelling(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiPost('/api/donors/me/commitment/cancel', {});
      setSuccessMsg('Commitment cancelled. Your units are open for other donors again.');
      loadAll();
      setTab('tab-feed');
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  async function reportUnsuccessful() {
    setReportingUnsuccessful(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiPost('/api/donors/me/commitment/unsuccessful', {});
      setSuccessMsg('Your donation was marked unsuccessful. Your units are open for other donors again.');
      loadAll();
      setTab('tab-feed');
    } catch (err) {
      setError(err.message);
    } finally {
      setReportingUnsuccessful(false);
    }
  }

  async function advanceJourney(nextStep) {
    setError('');
    setSuccessMsg('');
    try {
      await apiPatch('/api/donors/me/commitment/step', { step: nextStep });
      setSuccessMsg(`Status updated to: ${committedStateLabel(nextStep)}`);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  // Past-donation history entries only. While committed, a donation is claimed
  // from the commitment itself (after arriving), never logged here.
  function openLogModal() {
    if (profile?.committed_request_id) {
      setSuccessMsg('');
      setError('You have an active commitment. Use Mark as Donated on your commitment after you arrive; the requester has to confirm it before it counts.');
      return;
    }
    setClaimMode(false);
    setLogModalOpen(true);
  }

  function openClaimModal() {
    setError('');
    setClaimMode(true);
    setLogForm((f) => ({ ...f, hospital_name: f.hospital_name || profile?.committed_request?.hospital_name || '' }));
    setLogModalOpen(true);
  }

  async function handleLogDonationSubmit(e) {
    e.preventDefault();
    setSubmittingDonation(true);
    setError('');
    try {
      if (claimMode) {
        await apiPost('/api/donors/me/commitment/claim', {
          ...logForm,
          request_id: profile?.committed_request_id || undefined,
        });
        setLogModalOpen(false);
        setSuccessMsg('Donation claim sent. It counts once the requester confirms it; your cooldown starts then.');
        loadAll();
      } else {
        await apiPost('/api/donors/me/donations', { ...logForm });
        setLogModalOpen(false);
        setSuccessMsg('Blood donation recorded! 90-day cooldown countdown has been activated.');
        loadAll();
        setTab('tab-cooldown');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingDonation(false);
    }
  }

  async function saveDetails(e) {
    e.preventDefault();
    setSavingDetails(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiPut('/api/donors/me', {
        blood_group: detailsForm.blood_group,
        last_donation_date: detailsForm.last_donation_date || undefined,
      });
      setEditing(false);
      setSuccessMsg('Donor details updated successfully.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingDetails(false);
    }
  }

  const locationMode = profile?.location_mode || 'city';

  // Saves the donor's current position so the alert radius is measured from
  // where they actually are. It is only used for distance and is not shown to
  // requesters.
  function saveCurrentLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot share your location. Your city will be used instead.');
      return;
    }
    setLocating(true);
    setError('');
    setSuccessMsg('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await apiPut('/api/donors/me/location', {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          setSuccessMsg('Location saved. Requests are now measured from where you are.');
          loadAll();
        } catch (err) {
          setError(err.message);
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setError('Could not read your location. Allow location access in the browser, or keep using your city.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function saveCityLocation() {
    setLocating(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiPut('/api/donors/me/location', { clear: true });
      setSuccessMsg('Using your city as your location.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setLocating(false);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setError('');
    setSuccessMsg('');
    try {
      await apiPatch('/api/donors/me/settings', settingsForm);
      setSuccessMsg('Donor preferences and privacy settings saved.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleLogout() {
    // Stop this device receiving push alerts for the account that just left.
    // Needs the token, so it runs before the session is cleared; best effort.
    try { await disablePush(); } catch { /* logging out must never be blocked */ }
    clearSession();
    navigate('/login');
  }

  // Area filter options come from the cities of the requests actually shown,
  // so the app works for any city instead of a hardcoded list.
  const areaOptions = useMemo(() => {
    const cities = [...new Set(matches.map((m) => (m.city || '').trim()).filter(Boolean))].sort();
    return [{ value: 'all', label: 'All areas' }, ...cities.map((c) => ({ value: c, label: c }))];
  }, [matches]);

  const filteredMatches = useMemo(() => {
    if (areaFilter === 'all') return matches;
    return matches.filter((m) =>
      (m.city || '').toLowerCase().includes(areaFilter.toLowerCase()) ||
      (m.hospital_name || '').toLowerCase().includes(areaFilter.toLowerCase())
    );
  }, [matches, areaFilter]);

  if (!user) return null;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
  const status = profile?.current_status || 'AVAILABLE';
  const hasProfile = Boolean(profile?.blood_group);
  const hasCommitment = Boolean(profile?.committed_request_id) && COMMITMENT_STATES.includes(status);
  const canCancel = status === 'COMMITTED';
  const cooldownInfo = profile?.cooldown_info;
  const isEligible = cooldownInfo ? cooldownInfo.isEligible : true;
  // Level comes from the server (derived from the database), never from the browser.
  const verificationLevel = Number(profile?.verification?.level) || 1;
  const identityVerified = isIdentityVerified(profile);
  const needsIdentity = Boolean(profile) && !identityVerified;
  const daysRemaining = cooldownInfo ? cooldownInfo.daysRemaining : 0;
  const daysElapsed = cooldownInfo ? cooldownInfo.daysElapsed : null;
  const totalDonations = profile?.total_donations || donations.length;
  const livesSaved = profile?.lives_saved || totalDonations * 3;

  // Circular progress calculation
  // 90 days total: percentage of cooldown completed
  const cooldownPercent = isEligible ? 100 : Math.min(100, Math.round(((90 - daysRemaining) / 90) * 100));
  const strokeDashoffset = 100 - cooldownPercent;

  // Compatibility matrix logic for donor
  const donorGroup = profile?.blood_group || 'O+';
  const recipientsList = donorGroup.includes('+')
    ? (donorGroup === 'O+' ? 'O+, A+, B+, AB+' : donorGroup === 'A+' ? 'A+, AB+' : donorGroup === 'B+' ? 'B+, AB+' : 'AB+')
    : (donorGroup === 'O-' ? 'All 8 Blood Types (Universal)' : donorGroup === 'A-' ? 'A-, A+, AB-, AB+' : donorGroup === 'B-' ? 'B-, B+, AB-, AB+' : 'AB-, AB+');

  return (
    <DashboardLayout user={user} onLogout={handleLogout}>
      {/* Dashboard Top Header */}
      <div
        className="dashboard-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}
      >
        <div>
          <h1>Hi, {firstName}</h1>
          <p className="dashboard-subtext">
            Here&apos;s a quick look at your donor activity today.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: profile?.is_available ? 'var(--success)' : 'var(--ink-muted)', transition: 'color 0.3s ease' }}>
            {profile?.is_available ? 'Available to donate' : 'Not available'}
          </span>
          <div className={`toggle-wrap${profile?.is_available ? ' is-on' : ''}${glow ? ' is-glowing' : ''}`}>
            <span className="toggle-halo" aria-hidden="true" />
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(profile?.is_available)}
              aria-label="Available to donate"
              onClick={toggleAvailability}
              disabled={!hasProfile}
              className="toggle-switch"
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
      </div>

      <NotificationPopups
        items={notif.items}
        soundState={soundUi === 'on' && notif.soundBlocked ? 'blocked' : soundUi}
        onEnableSound={turnOnSoundFromPopup}
        onView={viewFromNotification}
        onAccept={acceptFromNotification}
        onDismiss={(n) => notif.dismiss(n.id)}
        acceptingRequestId={actingOn}
        canAccept={Boolean(profile?.is_available) && isEligibleForAlerts(profile)}
        identityRequired={needsIdentity}
        onVerify={() => setTab('tab-verification')}
      />

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
          {needsIdentity && (
            <IdentityRequiredNotice level={verificationLevel} onVerify={() => setTab('tab-verification')} />
          )}
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <div className="stat-card">
              <div className="stat-card-label"><span>Eligibility</span><ClockIcon size={16} /></div>
              <div className="stat-card-value" style={{ color: isEligible ? 'var(--success)' : 'var(--amber)' }}>
                {isEligible ? 'Eligible' : `${daysRemaining}d left`}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label"><span>Open Matches</span><AlertCircleIcon size={16} /></div>
              <div className="stat-card-value">{matches.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label"><span>Total Donations</span><DropletIcon size={16} /></div>
              <div className="stat-card-value">{totalDonations}</div>
            </div>
            <div className="stat-card stat-card--accent">
              <div className="stat-card-label"><span>Lives Impacted</span><HeartIcon size={16} /></div>
              <div className="stat-card-value">{livesSaved}</div>
            </div>
          </div>

          {/* Active commitment summary */}
          {hasCommitment && (
            <div className="form-card" style={{ borderLeft: '4px solid var(--primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>You have an active commitment</h3>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                    {profile?.committed_request?.hospital_name || 'Hospital'}
                    {profile?.committed_request?.city ? `, ${profile.committed_request.city}` : ''} &middot; {committedStateLabel(status)}
                  </p>
                </div>
                <button onClick={() => setTab('tab-commitments')} className="btn btn-primary">
                  View Commitment
                </button>
              </div>
            </div>
          )}

          {/* Latest compatible emergencies */}
          <div className="form-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Latest emergencies for you</h3>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                  Compatible with your {donorGroup} blood group
                </p>
              </div>
              {matches.length > 0 && (
                <button onClick={() => setTab('tab-feed')} className="btn btn-secondary" style={{ fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}>
                  View all ({matches.length})
                </button>
              )}
            </div>

            {matches.length === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>
                {matchesReason || 'No compatible verified emergencies right now. New ones will appear here automatically.'}
              </p>
            ) : (
              <div className="stack" style={{ gap: '0.6rem' }}>
                {matches.slice(0, 3).map((m) => (
                  <div
                    key={m.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.9rem' }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: 'var(--primary)', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {m.blood_group}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '0.92rem' }}>{m.patient_case || 'Urgent Blood Transfusion'}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                        {m.hospital_name}{m.city ? `, ${m.city}` : ''} &middot; {m.units_open ?? m.units_needed} of {m.units_needed} unit{m.units_needed > 1 ? 's' : ''} still open
                        {m.distance_km != null && <> &middot; {m.distance_approximate ? '≈ ' : ''}{m.distance_km} km away</>}
                      </span>
                    </div>
                    <span className={`badge ${URGENCY_BADGE[m.urgency] || 'badge-neutral'}`}>{m.urgency}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cooldown summary */}
          <div className="form-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                {isEligible ? 'You can donate today' : `Back to donating on ${formatDate(cooldownInfo?.cooldownUntil)}`}
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                Last donation: {profile?.last_donation_date ? formatDate(profile.last_donation_date) : 'none recorded'}
                {daysElapsed !== null ? ` (${daysElapsed} days ago)` : ''}
              </p>
            </div>
            <button onClick={openLogModal} className="btn btn-secondary">
              + Record a Donation
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1: EMERGENCY MATCHES FEED                                    */}
      {/* ================================================================= */}
      {activeTab === 'tab-feed' && (
        <div className="tab-content stack" style={{ gap: '1.25rem' }}>
          {needsIdentity && (
            <IdentityRequiredNotice level={verificationLevel} onVerify={() => setTab('tab-verification')} />
          )}
          {/* Compatibility Explanation & Area Filter Banner */}
          <div
            className="form-card"
            style={{
              background: 'linear-gradient(to right, var(--accent-light), var(--surface))',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '1.1rem 1.35rem',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                <span className="pulse-dot" style={{ background: 'var(--primary)' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                  Matching Emergency Requests ({donorGroup})
                </h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-muted)', maxWidth: 'none' }}>
                As a registered <strong style={{ color: 'var(--primary)' }}>{donorGroup} donor</strong>, you can safely donate to patients requiring <strong style={{ color: 'var(--primary-dark)' }}>{recipientsList}</strong> blood.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', fontWeight: 600 }}>Filter Area:</span>
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-strong)',
                  background: 'var(--surface)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                }}
              >
                {areaOptions.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Emergency Cards Grid */}
          {filteredMatches.length === 0 ? (
            <div className="form-card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
              <DropletIcon size={36} />
              <p className="empty-state" style={{ marginTop: '0.75rem', fontSize: '1rem' }}>
                {matchesReason || 'No compatible verified emergencies currently matching your blood group.'}
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', margin: '0 auto' }}>
                When hospitals post new verified emergencies for {donorGroup}, they will automatically appear here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
              {filteredMatches.map((m) => (
                <div key={m.id} id={`request-${m.id}`} className="record-card state-critical" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
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
                            boxShadow: 'var(--shadow-sm)',
                          }}
                        >
                          {m.blood_group}
                        </div>
                        <div>
                          <strong style={{ display: 'block', fontSize: '0.98rem' }}>
                            {m.patient_case || 'Urgent Blood Transfusion'}
                          </strong>
                          <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            <HospitalIcon size={14} /> {m.hospital_name}
                          </span>
                        </div>
                      </div>
                      <span className={`badge ${URGENCY_BADGE[m.urgency] || 'badge-neutral'}`}>
                        {m.urgency === 'critical' ? 'Critical · < 2 hrs' : m.urgency === 'high' ? 'Urgent · < 6 hrs' : 'Standard'}
                      </span>
                    </div>

                    <div
                      style={{
                        background: 'var(--paper)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.65rem 0.85rem',
                        margin: '0.75rem 0',
                        fontSize: '0.8rem',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '0.5rem',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>UNITS NEEDED</span>
                        <strong style={{ color: 'var(--primary)' }}>
                          {m.units_open ?? m.units_needed} of {m.units_needed} Unit{m.units_needed > 1 ? 's' : ''} still open
                        </strong>
                        {Number(m.units_donated) > 0 && (
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                            {m.units_donated} already donated
                          </span>
                        )}
                        {m.distance_km != null && (
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                            {m.distance_approximate ? '≈ ' : ''}{m.distance_km} km from you
                          </span>
                        )}
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>LOCATION</span>
                        <strong>{m.city || '—'}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>POSTED BY</span>
                        <span>{m.attendant_name || m.requester_name || 'Hospital Attendant'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>VERIFICATION</span>
                        <span style={{ color: '#15803d', fontWeight: 600 }}>Hospital Verified</span>
                      </div>
                    </div>

                    {m.required_by && (
                      <p style={{ fontSize: '0.78rem', color: 'var(--amber)', margin: '0 0 0.5rem' }}>
                        <ClockIcon size={12} /> Needed by: {formatDateTime(m.required_by)}
                      </p>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                    {needsIdentity ? (
                      <button
                        type="button"
                        onClick={() => setTab('tab-verification')}
                        className="btn btn-secondary"
                        style={{ flex: 1, padding: '0.55rem', fontSize: '0.88rem' }}
                        title="Identity verification (Level 3) is required before you can accept a request"
                      >
                        <ShieldCheckIcon size={14} />
                        Verify Identity to Accept
                      </button>
                    ) : (
                      <button
                        onClick={() => respondTo(m.id, 'accept')}
                        disabled={actingOn === m.id || !profile?.is_available || !isEligible}
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '0.55rem', fontSize: '0.88rem' }}
                        title={!profile?.is_available ? 'Enable availability above to respond' : !isEligible ? 'In 90-day cooldown' : ''}
                      >
                        <HeartIcon size={14} />
                        {actingOn === m.id ? 'Accepting...' : 'I Can Donate'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: 3-MONTH COOLDOWN & DONATION HISTORY                       */}
      {/* ================================================================= */}
      {activeTab === 'tab-cooldown' && (
        <div className="tab-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
          {/* Circular Medical Cooldown Tracker Card */}
          <div className="form-card" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Medical Cooldown Tracker</h3>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>WHO / SBTP 90-DAY STANDARD</span>
            </div>

            <div className="cooldown-circle-wrap">
              <svg className="cooldown-circle-svg" viewBox="0 0 36 36">
                <path
                  stroke="var(--border)"
                  strokeWidth="3.5"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  stroke={isEligible ? 'var(--success)' : 'var(--amber)'}
                  strokeWidth="3.5"
                  strokeDasharray={`${cooldownPercent}, 100`}
                  strokeLinecap="round"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="cooldown-circle-center">
                <HeartIcon size={22} />
                <strong style={{ fontSize: '1.1rem', color: isEligible ? 'var(--success)' : 'var(--amber)' }}>
                  {isEligible ? 'READY' : `${daysRemaining}d`}
                </strong>
                <span style={{ fontSize: '0.65rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                  {isEligible ? 'Eligible' : 'Cooldown'}
                </span>
              </div>
            </div>

            <p style={{ fontWeight: 700, color: isEligible ? 'var(--success)' : 'var(--amber)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              {isEligible
                ? 'You are fully eligible to donate blood today!'
                : `In 90-Day Medical Cooldown until ${formatDate(cooldownInfo?.cooldownUntil)}`}
            </p>

            <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', margin: '0 0 1.25rem' }}>
              Last Donation: <strong>{formatDate(profile?.last_donation_date) || 'None recorded'}</strong>
              {daysElapsed !== null ? ` (${daysElapsed} days ago)` : ''}
            </p>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginBottom: '1.25rem', textAlign: 'left', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Standard Cooldown Rule</span>
                <strong>90 Days (3 Months)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Estimated Lives Impacted</span>
                <strong style={{ color: 'var(--primary)' }}>{livesSaved} Lives ({totalDonations} Donations)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Identity Verification</span>
                <span style={{ color: identityVerified ? '#15803d' : 'var(--amber)', fontWeight: 600 }}>
                  {profile?.verification?.label || 'Registered'}
                </span>
              </div>
            </div>

            <button
              onClick={openLogModal}
              className="btn btn-primary btn-block"
            >
              + Record New Donation Today
            </button>
          </div>

          {/* Verified Donation History Table */}
          <div className="form-card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Verified Donation History</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                  Each verified donation safely resets your 90-day medical cooldown
                </p>
              </div>
              <button
                onClick={openLogModal}
                className="btn btn-secondary"
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}
              >
                + Log Past Donation
              </button>
            </div>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Hospital / Facility</th>
                    <th>Units &amp; Type</th>
                    <th>Case Reference</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {donations.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem 1rem' }}>
                        No past donations recorded yet. Click &quot;Record New Donation Today&quot; to log your history.
                      </td>
                    </tr>
                  ) : (
                    donations.map((d) => (
                      <tr key={d.id}>
                        <td><strong>{formatDate(d.donation_date)}</strong></td>
                        <td>{d.hospital_name}</td>
                        <td>
                          <span className="badge badge-red">{d.units} Unit ({d.blood_group})</span>
                        </td>
                        <td style={{ color: 'var(--ink-muted)' }}>{d.recipient_case || 'Voluntary Emergency Response'}</td>
                        <td>
                          <span className={`badge ${d.is_verified ? 'badge-teal' : 'badge-amber'}`}>
                            {d.is_verified ? 'Verified' : 'Logged'}
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

      {/* ================================================================= */}
      {/* TAB 3: ACTIVE COMMITMENTS                                        */}
      {/* ================================================================= */}
      {activeTab === 'tab-commitments' && (
        <div className="tab-content stack" style={{ gap: '1.5rem' }}>
          {(profile?.recent_claims || []).filter((c) => c.status === 'disputed').map((c) => (
            <div key={c.request_id} className="form-card" style={{ borderLeft: '4px solid var(--amber)' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Donation not confirmed &mdash; request #{c.request_id}</h3>
              <p style={{ margin: '0.35rem 0 0.75rem', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                The requester marked your donation claim at {c.hospital_name} as not having happened, so it was not counted and no cooldown was started.
                If you did donate, report a problem and an administrator will look into it.
              </p>
              {c.reported ? (
                <span className="badge badge-neutral">Problem reported</span>
              ) : (
                <button onClick={() => setReportTarget({ requestId: c.request_id })} className="btn btn-secondary">
                  Report a Problem
                </button>
              )}
            </div>
          ))}
          {!hasCommitment ? (
            <div className="form-card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
              <HeartIcon size={40} />
              <h3 style={{ marginTop: '0.75rem', marginBottom: '0.35rem' }}>No Active Commitment</h3>
              <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem', maxWidth: '50ch', margin: '0 auto 1.5rem' }}>
                {identityVerified
                  ? 'You have not committed to an emergency request at this moment. You are free to view matches and accept requests.'
                  : 'You have not committed to an emergency request at this moment. Identity verification (Level 3) is required before you can accept a request.'}
              </p>
              <button onClick={() => setTab('tab-feed')} className="btn btn-primary">
                View Emergency Matches Feed
              </button>
            </div>
          ) : (
            <div className="form-card" style={{ borderLeft: '4px solid var(--primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem' }}>
                    Active Emergency Commitment #{profile?.committed_request_id}
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                    Keep the patient attendant updated on your arrival status
                  </p>
                </div>
                <span className="badge badge-amber" style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}>
                  Status: {committedStateLabel(status)}
                </span>
              </div>

              {/* Destination & Contact Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                  background: 'var(--paper)',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  marginBottom: '1.25rem',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--ink-muted)', display: 'block', marginBottom: '0.2rem' }}>
                    Destination Hospital
                  </span>
                  <strong style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <HospitalIcon size={16} /> {profile?.committed_request?.hospital_name || 'Hospital'}
                  </strong>
                  <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                    {profile?.committed_request?.city || ''}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--ink-muted)', display: 'block', marginBottom: '0.2rem' }}>
                    Requester Contact
                  </span>
                  <strong style={{ fontSize: '0.95rem' }}>
                    {profile?.committed_request?.attendant_name || profile?.committed_request?.requester_name || 'Patient Attendant'}
                  </strong>
                  {profile?.committed_request?.contact_phone && (
                    <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.75rem', fontSize: '0.85rem' }}>
                      <a href={`tel:${profile.committed_request.contact_phone}`} style={{ fontWeight: 600 }}>
                        <PhoneIcon size={12} /> {profile.committed_request.contact_phone}
                      </a>
                    </div>
                  )}
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--ink-muted)', display: 'block', marginBottom: '0.2rem' }}>
                    Blood Request Case
                  </span>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--primary)' }}>
                    {profile?.committed_request?.units_required ?? profile?.committed_request?.units_needed ?? 1} Unit(s) {profile?.committed_request?.blood_group || profile?.blood_group}
                  </strong>
                  <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', display: 'block' }}>
                    {profile?.committed_request?.patient_case || 'Urgent Surgery Case'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--ink-muted)', display: 'block', marginBottom: '0.2rem' }}>
                    Unit Progress
                  </span>
                  <strong style={{ fontSize: '0.95rem' }}>
                    {profile?.committed_request?.units_donated ?? 0} donated &middot; {profile?.committed_request?.units_remaining ?? profile?.committed_request?.units_needed ?? 1} remaining
                  </strong>
                  <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', display: 'block' }}>
                    Required: {profile?.committed_request?.units_required ?? profile?.committed_request?.units_needed ?? 1} &middot; Your commitment: {profile?.committed_request?.my_committed_units ?? 1} unit(s), not yet donated
                  </span>
                </div>
              </div>

              {/* 4-Step Donation Journey Progress Tracker */}
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)' }}>
                  Donation Journey Progress:
                </span>
                <div className="journey-tracker">
                  <div className={`journey-step ${['COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED'].includes(status) ? 'is-done' : ''}`}>
                    <CheckCircleIcon size={16} />
                    <span>1. Matched</span>
                  </div>
                  <div className={`journey-step ${['EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED'].includes(status) ? 'is-done' : status === 'COMMITTED' ? 'is-current' : ''}`}>
                    <CarIcon size={16} />
                    <span>2. En Route</span>
                  </div>
                  <div className={`journey-step ${['ARRIVED', 'DONATING', 'DONATION_COMPLETED'].includes(status) ? 'is-done' : status === 'EN_ROUTE' ? 'is-current' : ''}`}>
                    <HospitalIcon size={16} />
                    <span>3. At Hospital</span>
                  </div>
                  <div className={`journey-step ${['DONATION_COMPLETED'].includes(status) ? 'is-done' : status === 'ARRIVED' ? 'is-current' : ''}`}>
                    <CheckCircleIcon size={16} />
                    <span>4. Donation Claimed</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                {status === 'COMMITTED' && (
                  <button
                    onClick={() => advanceJourney('EN_ROUTE')}
                    className="btn btn-primary"
                  >
                    <CarIcon size={16} /> I Am En Route to Hospital
                  </button>
                )}

                {status === 'EN_ROUTE' && (
                  <button
                    onClick={() => advanceJourney('ARRIVED')}
                    className="btn btn-primary"
                  >
                    <HospitalIcon size={16} /> I Have Arrived at Hospital
                  </button>
                )}

                {(status === 'ARRIVED' || status === 'DONATING') && (
                  <button
                    onClick={openClaimModal}
                    className="btn btn-secondary"
                    style={{ borderColor: 'var(--success)', color: '#15803d' }}
                  >
                    <CheckCircleIcon size={16} /> Mark as Donated
                  </button>
                )}

                {status === 'DONATION_COMPLETED' && (
                  <span className="badge badge-amber" style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem' }}>
                    <ClockIcon size={14} /> Waiting for the requester to confirm your donation
                  </span>
                )}

                <button
                  onClick={() => setShowChat((v) => !v)}
                  className="btn btn-secondary"
                >
                  {showChat ? 'Hide Chat' : 'Chat with Requester'}
                </button>

                <button
                  onClick={() => setReportTarget({ requestId: profile.committed_request_id })}
                  className="btn btn-text"
                  style={{ color: 'var(--primary)' }}
                >
                  Report a Problem
                </button>

                {(status === 'EN_ROUTE' || status === 'ARRIVED' || status === 'DONATING') && (
                  <button
                    onClick={() => {
                      if (window.confirm('Report that your donation did not happen or was unsuccessful? Your units will be opened up for other donors.')) {
                        reportUnsuccessful();
                      }
                    }}
                    disabled={reportingUnsuccessful}
                    className="btn btn-text"
                    style={{ marginLeft: 'auto', color: 'var(--primary)' }}
                  >
                    {reportingUnsuccessful ? 'Reporting...' : 'Donation Unsuccessful (Release my units)'}
                  </button>
                )}

                {canCancel && (
                  <button
                    onClick={() => {
                      if (window.confirm('Cancel your commitment? The emergency request will immediately be reopened for other donors.')) {
                        cancelCommitment();
                      }
                    }}
                    disabled={cancelling}
                    className="btn btn-text"
                    style={{ marginLeft: 'auto', color: 'var(--primary)' }}
                  >
                    {cancelling ? 'Cancelling...' : "Can't Make It (Re-open for other donors)"}
                  </button>
                )}
              </div>

              {/* Embedded In-App Chat */}
              {showChat && (
                <div style={{ marginTop: '1.25rem' }}>
                  <ChatPanel
                    requestId={profile.committed_request_id}
                    currentUserId={user.id}
                    onClose={() => setShowChat(false)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: DONOR IDENTITY CARD                                       */}
      {/* ================================================================= */}
      {activeTab === 'tab-card' && (
        <div className="tab-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
          {/* Digital Donor Identity Card */}
          <div className="donor-id-card">
            <div className="donor-id-watermark">
              <DropletIcon size={180} />
            </div>

            <div className="donor-id-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheckIcon size={24} />
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.88rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Blood Donor Network
                  </h4>
                  <span style={{ fontSize: '0.7rem', color: 'var(--accent-light)' }}>
                    Official Donor Identity Pass
                  </span>
                </div>
              </div>
              <VerificationBadge
                verification={profile?.verification}
                uppercase
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}
              />
            </div>

            <div className="donor-id-main">
              <div className="donor-blood-avatar">
                <span>{profile?.blood_group || 'O+'}</span>
                <span className="donor-blood-rh">
                  {donorGroup.includes('+') ? 'Rh Positive' : 'Rh Negative'}
                </span>
              </div>
              <div className="donor-id-meta">
                <h3>{user.name}</h3>
                <div className="donor-id-code">ID: BD-{new Date().getFullYear()}-{String(user.id).padStart(4, '0')}</div>
                {profile?.city && (
                  <p className="donor-id-sub">
                    <MapPinIcon size={14} /> {profile.city}
                  </p>
                )}
                {user.phone && (
                  <p className="donor-id-sub" style={{ marginTop: '0.2rem' }}>
                    <PhoneIcon size={14} /> {user.phone}
                  </p>
                )}
              </div>
            </div>

            <div className="donor-id-footer">
              <div>
                <span>Eligibility</span>
                <strong style={{ color: isEligible ? '#86efac' : '#fcd34d' }}>
                  {isEligible ? 'Ready / Fit' : `${daysRemaining}d Cooldown`}
                </strong>
              </div>
              <div>
                <span>Total Donations</span>
                <strong>{totalDonations} Times</strong>
              </div>
              <div>
                <span>Lives Saved</span>
                <strong style={{ color: '#fcd34d' }}>{livesSaved} Patients</strong>
              </div>
            </div>
          </div>

          {/* Blood Compatibility Matrix Logic Reference (Section 3.3) */}
          <div className="form-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <DropletIcon size={18} /> Compatibility Matrix Logic
              </h3>
              <span className="badge badge-teal">Section 3.3 Brief</span>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: '1rem' }}>
              Correct matching rules are strictly verified across all 8 blood groups:
            </p>

            <div className="stack" style={{ gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ background: 'var(--paper)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <strong style={{ color: 'var(--primary)', display: 'block', marginBottom: '0.25rem' }}>
                  Your Group ({donorGroup}):
                </strong>
                <p style={{ margin: 0, color: 'var(--ink)' }}>
                  You can give red blood cells to: <strong>{recipientsList}</strong>
                </p>
              </div>

              <div style={{ background: 'var(--paper)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <strong style={{ color: 'var(--ink)', display: 'block', marginBottom: '0.25rem' }}>
                  Universal Rules in the System:
                </strong>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                  <li><strong style={{ color: 'var(--primary)' }}>O- (Negative)</strong>: Universal Donor &mdash; compatible with all 8 groups.</li>
                  <li><strong style={{ color: 'var(--primary)' }}>AB+ (Positive)</strong>: Universal Recipient &mdash; can receive from all 8 groups.</li>
                  <li><strong style={{ color: 'var(--primary)' }}>Rh Factor Rule</strong>: Negative blood can give to positive, but positive cannot give to negative.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* VERIFICATION: IDENTITY (REQUIRED TO DONATE) + DONATION EVIDENCE */}
      {/* ================================================================= */}
      {activeTab === 'tab-verification' && <VerificationPanel />}

      {/* ================================================================= */}
      {/* TAB 5: DONOR SETTINGS                                            */}
      {/* ================================================================= */}
      {activeTab === 'tab-settings' && (
        <div className="tab-content" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1.5rem', alignItems: 'start' }}>
          {/* Availability & Privacy Controls */}
          <div className="form-card">
            <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>
              Availability &amp; Privacy Controls
            </h3>

            <form onSubmit={saveSettings} className="settings-form-grid">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.9rem' }}>Emergency Availability</strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Pause when travelling, sick, or busy to stop urgent alerts
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={profile?.is_available || false}
                  onChange={toggleAvailability}
                  style={{ width: 18, height: 18, accentColor: 'var(--primary)' }}
                />
              </label>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.9rem' }}>Abuse Prevention (Phone Masking)</strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    Only reveal your phone number after you accept a verified request
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.phone_masked}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, phone_masked: e.target.checked }))}
                  style={{ width: 18, height: 18, accentColor: 'var(--primary)' }}
                />
              </label>

              {/* Alert Radius Slider */}
              <div className="span-2" style={{ background: 'var(--paper)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>Maximum Alert Radius</strong>
                  <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
                    {settingsForm.alert_radius} km
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="25"
                  step="1"
                  value={settingsForm.alert_radius}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, alert_radius: Number(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--primary)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--ink-muted)', marginTop: '0.2rem' }}>
                  <span>2 km (Local neighborhood)</span>
                  <span>10 km (Citywide)</span>
                  <span>25 km (Wider region)</span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', margin: '0.6rem 0 0' }}>
                  You will only see emergencies within {settingsForm.alert_radius} km of{' '}
                  {locationMode === 'gps' ? 'your saved location.' : `your city${profile?.city ? ` (${profile.city})` : ''}. Distances between cities are approximate.`}
                  {' '}Save settings to apply a new radius.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={saveCurrentLocation} disabled={locating}>
                    {locating ? 'Locating…' : 'Use my current location'}
                  </button>
                  {locationMode === 'gps' && (
                    <button type="button" className="btn btn-secondary" onClick={saveCityLocation} disabled={locating}>
                      Use my city instead
                    </button>
                  )}
                </div>
              </div>

              {/* Notification Channels */}
              <div style={{ background: 'var(--paper)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>
                  Urgent Notification Channels
                </strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem', textAlign: 'center' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settingsForm.notify_inapp}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, notify_inapp: e.target.checked }))}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>In-App</span>
                  </label>
                </div>
              </div>

              <button type="submit" disabled={savingSettings} className="btn btn-primary" style={{ gridColumn: '1 / -1' }}>
                {savingSettings ? 'Saving...' : 'Save Settings & Preferences'}
              </button>
            </form>
          </div>

          <NotificationSettings
            profile={profile}
            onSaved={loadAll}
            onSoundChange={setSoundUi}
            setError={setError}
            setSuccess={setSuccessMsg}
          />

          {/* Profile & Medical Registration */}
          <div className="form-card" style={{ maxWidth: 560 }}>
            <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem' }}>
              Donor Registration Details
            </h3>

            <form onSubmit={saveDetails} className="stack" style={{ gap: '1rem' }}>
              <label className="field">
                Blood Group
                <select
                  value={detailsForm.blood_group}
                  onChange={(e) => setDetailsForm((f) => ({ ...f, blood_group: e.target.value }))}
                  required
                >
                  <option value="" disabled>Select your blood group</option>
                  {BLOOD_GROUPS.map((bg) => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                Last Recorded Donation Date
                <input
                  type="date"
                  max={todayForDateInput()}
                  value={detailsForm.last_donation_date}
                  onChange={(e) => setDetailsForm((f) => ({ ...f, last_donation_date: e.target.value }))}
                />
              </label>

              <p className="disclaimer" style={{ margin: 0 }}>
                Changing your declared blood group resets verification until confirmed by an admin.
              </p>

              <button type="submit" disabled={savingDetails} className="btn btn-secondary">
                {savingDetails ? 'Saving...' : 'Update Donor Profile'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* INTERACTIVE MODAL: RECORD BLOOD DONATION                          */}
      {/* ================================================================= */}
      {logModalOpen && (
        <div className="modal-backdrop" onClick={() => setLogModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <DropletIcon size={20} /> {claimMode ? 'Mark as Donated' : 'Record Blood Donation'}
              </h3>
              <button
                type="button"
                onClick={() => setLogModalOpen(false)}
                className="btn-text"
                style={{ fontSize: '1.2rem', color: 'var(--ink-muted)' }}
              >
                <XIcon size={18} />
              </button>
            </div>

            {claimMode ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: '1.25rem' }}>
                This sends a <strong>donation claim</strong> to the requester. It is <strong>not counted</strong> and your{' '}
                <strong style={{ color: 'var(--amber)' }}>90-day cooldown does not start</strong> until the requester confirms they received it.
              </p>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: '1.25rem' }}>
                Recording a past donation resets your <strong style={{ color: 'var(--amber)' }}>90-day medical cooldown countdown</strong> and updates your availability status.
              </p>
            )}

            <form onSubmit={handleLogDonationSubmit} className="stack" style={{ gap: '1rem' }}>
              <label className="field">
                Donation Date
                <input
                  type="date"
                  max={todayForDateInput()}
                  value={logForm.donation_date}
                  onChange={(e) => setLogForm((f) => ({ ...f, donation_date: e.target.value }))}
                  required
                />
              </label>

              <label className="field">
                Hospital / Donation Center
                <input
                  type="text"
                  placeholder="e.g. City General Hospital"
                  value={logForm.hospital_name}
                  onChange={(e) => setLogForm((f) => ({ ...f, hospital_name: e.target.value }))}
                  required
                />
              </label>

              <label className="field">
                Patient / Case Reference (Optional)
                <input
                  type="text"
                  placeholder="e.g. Trauma Surgery Ward / REQ-1049"
                  value={logForm.recipient_case}
                  onChange={(e) => setLogForm((f) => ({ ...f, recipient_case: e.target.value }))}
                />
              </label>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" disabled={submittingDonation} className="btn btn-primary" style={{ flex: 1 }}>
                  {submittingDonation ? 'Saving...' : claimMode ? 'Send Donation Claim' : 'Save & Start 90-Day Cooldown'}
                </button>
                <button type="button" onClick={() => setLogModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {reportTarget && (
        <ReportProblemModal
          role="donor"
          requestId={reportTarget.requestId}
          subject={`About request #${reportTarget.requestId}`}
          onClose={() => setReportTarget(null)}
          onDone={(message) => { setReportTarget(null); setError(''); setSuccessMsg(message); loadAll(); }}
        />
      )}
    </DashboardLayout>
  );
}
