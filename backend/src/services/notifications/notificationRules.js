// Pure decision logic for "should this donor be notified about this request
// right now, and on which channels?" No DB access, same style as alertRules.js.
//
// The server decides. The frontend never tells the backend who is eligible.
import { canDonorGiveToRecipient } from '../matching/compatibility.js';
import { isEligibleByRecency } from '../matching/donorMatching.js';
import { canDonorAccept, REQUEST_STATUSES_OPEN_FOR_ACCEPT } from '../matching/donorState.js';
import { checkRadius, DEFAULT_ALERT_RADIUS_KM } from '../geo.js';
import { computeUnitProgress } from '../requestUnits.js';

// request:  requests row + units_donated / units_committed
// donor:    { account: users row, profile: donor_profiles row incl. alert_radius,
//             latitude, longitude, notify_* }
// Returns { ok: true, channels: { inapp, browser, push }, km } or
//         { ok: false, reason } where reason is an internal code (not shown to requesters).
export function evaluateNotification({ request, donor, ttlHours, now = Date.now() }) {
  if (!request) return { ok: false, reason: 'request_missing' };
  if (!request.is_verified) return { ok: false, reason: 'request_unverified' };
  if (!REQUEST_STATUSES_OPEN_FOR_ACCEPT.includes(request.status)) return { ok: false, reason: 'request_closed' };

  const expiresAt = request.required_by
    ? new Date(request.required_by).getTime()
    : new Date(request.created_at).getTime() + ttlHours * 60 * 60 * 1000;
  if (Number.isNaN(expiresAt) || expiresAt < now) return { ok: false, reason: 'request_expired' };

  if (computeUnitProgress(request).open <= 0) return { ok: false, reason: 'no_units_open' };

  const { account, profile } = donor || {};
  if (!account || account.role !== 'donor' || account.is_suspended) return { ok: false, reason: 'donor_unavailable' };
  if (!canDonorAccept(profile).ok) return { ok: false, reason: 'donor_unavailable' };
  if (!canDonorGiveToRecipient(profile.blood_group, request.blood_group)) return { ok: false, reason: 'incompatible' };
  if (!isEligibleByRecency(profile.last_donation_date)) return { ok: false, reason: 'cooldown' };

  const within = checkRadius({
    donor: { latitude: profile.latitude, longitude: profile.longitude, city: account.city },
    request: { latitude: request.latitude, longitude: request.longitude, city: request.city },
    radiusKm: Number(profile.alert_radius) || DEFAULT_ALERT_RADIUS_KM,
  });
  if (!within.ok) return { ok: false, reason: 'outside_radius' };

  // Preferences: undefined/null counts as ON (columns default to TRUE).
  const on = (v) => v === undefined || v === null || Boolean(v);
  const channels = {
    inapp: on(profile.notify_inapp),
    browser: on(profile.notify_browser),
    push: on(profile.notify_push),
  };
  if (!channels.inapp && !channels.browser && !channels.push) return { ok: false, reason: 'channels_disabled' };

  return { ok: true, channels, km: within.km };
}

// Text shown in popups, system notifications and push. Deliberately limited to
// request facts a donor needs; never phone numbers, patient details or the
// requester's account data.
export function buildNotificationContent(request) {
  const group = request.blood_group;
  const urgencyLabel = { critical: 'CRITICAL', high: 'URGENT', medium: 'Needed', low: 'Needed' }[request.urgency] || 'Needed';
  return {
    title: `${urgencyLabel}: ${group} blood needed`,
    body: `${request.hospital_name}, ${request.city}`,
  };
}

export function requestUrl(requestId, notificationId) {
  const q = new URLSearchParams({ tab: 'tab-feed', request: String(requestId) });
  if (notificationId) q.set('notification', String(notificationId));
  return `/donor/dashboard?${q.toString()}`;
}
