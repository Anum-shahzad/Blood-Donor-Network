// Donor operational state machine — pure decision logic, no DB access.
// Kept separate from donorCommitment.js (which does the actual transactional
// read/write) so the rules themselves can be unit-tested with plain objects,
// the same way compatibility.js and donorMatching.js already are.
//
// Donor operational state is intentionally independent of account status
// (suspended/blocked). Account status doesn't exist as a column yet — it's
// Phase 3 in the implementation spec — so every function here assumes the
// caller has already confirmed the account itself is allowed to act.

export const DONOR_STATUSES = [
  'AVAILABLE',
  'MATCHED',
  'COMMITTED',
  'EN_ROUTE',
  'ARRIVED',
  'DONATING',
  'DONATION_COMPLETED',
  'COOLDOWN',
];

// Requests in these statuses are still open to a new donor accepting them.
// 'pending' is excluded on purpose — an unverified request must not start
// matching donors against it. 'donor_accepted' means at least one donor is
// committed; the request stays open to more donors for as long as units remain
// that nobody has donated or promised (see canRequestAcceptDonor).
export const REQUEST_STATUSES_OPEN_FOR_ACCEPT = ['verified', 'matched', 'donor_accepted'];

// Terminal statuses — nobody can accept a request that has reached one.
export const REQUEST_STATUSES_CLOSED_FOR_ACCEPT = [
  'fulfilled',
  'expired',
  'cancelled',
];

// A donor can only ever accept a new emergency from AVAILABLE. Every other
// state means they are already somewhere in a mission (or resting after
// one), and matching must not offer them a second one.
export function canDonorAccept(donorProfile) {
  if (!donorProfile) {
    return { ok: false, reason: 'Donor profile not found — set your blood group first' };
  }
  if (!donorProfile.is_available) {
    return { ok: false, reason: 'You have marked yourself unavailable' };
  }
  if (donorProfile.current_status !== 'AVAILABLE') {
    return {
      ok: false,
      reason: `You are currently ${donorProfile.current_status.toLowerCase()} and cannot accept another request`,
    };
  }
  return { ok: true };
}

// A request can only take a new commitment while it's actually open AND still
// has units nobody has donated or promised. `progress` (from requestUnits.js,
// read under the request row lock) carries that; when it is omitted only the
// status is checked.
export function canRequestAcceptDonor(request, progress) {
  if (!request) {
    return { ok: false, reason: 'Request not found' };
  }
  if (REQUEST_STATUSES_CLOSED_FOR_ACCEPT.includes(request.status)) {
    return { ok: false, reason: `This request is already ${request.status} — nothing left to accept` };
  }
  if (!REQUEST_STATUSES_OPEN_FOR_ACCEPT.includes(request.status)) {
    return { ok: false, reason: 'This request is not open for donor responses yet' };
  }
  if (progress && progress.open <= 0) {
    return { ok: false, reason: 'All units for this request are already committed or donated' };
  }
  return { ok: true };
}

// Only a donor who is actually mid-commitment can cancel out of it. Once
// they're past COMMITTED (already en route, arrived, etc.) cancellation
// goes through a different path in a later phase, not this one.
export function canDonorCancelCommitment(donorProfile) {
  if (!donorProfile) {
    return { ok: false, reason: 'Donor profile not found' };
  }
  if (donorProfile.current_status !== 'COMMITTED') {
    return {
      ok: false,
      reason: `Nothing to cancel — you are currently ${donorProfile.current_status.toLowerCase()}`,
    };
  }
  return { ok: true };
}

// What the request's status becomes once a donor commits (it stays open to
// further donors while units remain — see canRequestAcceptDonor).
export function requestStatusAfterAccept() {
  return 'donor_accepted';
}

// What a request reopens to when its LAST committed donor cancels (or their
// donation is unsuccessful). It goes back to 'matched' (not 'verified')
// because it has already been through the matching step at least once. While
// other donors are still committed it stays 'donor_accepted'.
export function requestStatusAfterCommitmentCancelled() {
  return 'matched';
}

export const JOURNEY_STEPS = ['COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED'];

// Validates whether a committed donor can advance their journey step.
// The workflow is strictly COMMITTED -> EN_ROUTE -> ARRIVED, with no skipping.
// The last step (Donation Claimed, stored as DONATION_COMPLETED) is NOT a plain
// step: it records a claim that the requester must confirm, so it only happens
// through canDonorClaimDonation / claimDonation, never through this function.
export function canDonorAdvanceJourney(donorProfile, nextStep) {
  if (!donorProfile) {
    return { ok: false, reason: 'Donor profile not found' };
  }
  if (!donorProfile.committed_request_id) {
    return { ok: false, reason: 'You have no active commitment' };
  }
  const current = donorProfile.current_status;
  const validTransitions = {
    COMMITTED: ['EN_ROUTE'],
    EN_ROUTE: ['ARRIVED'],
  };
  const allowed = validTransitions[current] || [];
  if (!allowed.includes(nextStep)) {
    return { ok: false, reason: `Cannot transition from ${current} to ${nextStep}` };
  }
  return { ok: true };
}

// A donation can only be claimed by a donor who has ARRIVED (DONATING is a
// legacy in-between state that is still accepted). DONATION_COMPLETED is also
// accepted so a donor left there by the old workflow, whose response is still
// 'accepted', can submit a proper claim; a second claim is stopped because the
// response is no longer 'accepted'. Never from COMMITTED or EN_ROUTE.
export const CLAIMABLE_DONOR_STATES = ['ARRIVED', 'DONATING', 'DONATION_COMPLETED'];
export function canDonorClaimDonation(donorProfile) {
  if (!donorProfile) {
    return { ok: false, reason: 'Donor profile not found' };
  }
  if (!donorProfile.committed_request_id) {
    return { ok: false, reason: 'You have no active commitment' };
  }
  if (!CLAIMABLE_DONOR_STATES.includes(donorProfile.current_status)) {
    return {
      ok: false,
      reason: `You can only mark a donation after you have arrived at the hospital (you are currently ${String(donorProfile.current_status).toLowerCase().replace(/_/g, ' ')})`,
    };
  }
  return { ok: true };
}

// Computes cooldown progress, remaining days, and eligibility
export function computeCooldownInfo(lastDonationDate, cooldownDays = 90) {
  if (!lastDonationDate) {
    return {
      isEligible: true,
      daysRemaining: 0,
      daysElapsed: null,
      cooldownUntil: null,
    };
  }
  const dateStr = String(lastDonationDate).split('T')[0];
  const donationTime = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(donationTime)) {
    return { isEligible: true, daysRemaining: 0, daysElapsed: null, cooldownUntil: null };
  }
  const now = Date.now();
  const msElapsed = now - donationTime;
  const daysElapsed = Math.max(0, Math.floor(msElapsed / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, cooldownDays - daysElapsed);
  const isEligible = daysRemaining === 0;
  const cooldownDate = new Date(donationTime + cooldownDays * 24 * 60 * 60 * 1000);
  const cooldownUntil = cooldownDate.toISOString().split('T')[0];

  return {
    isEligible,
    daysRemaining,
    daysElapsed,
    cooldownUntil,
  };
}

// The newest last_donation_date (YYYY-MM-DD, UTC) whose cooldown has already
// elapsed at `now`: a donation on or before this date is out of cooldown.
// It is the exact same boundary computeCooldownInfo() and isEligibleByRecency()
// use (a donation date counts from 00:00 UTC, and the cooldown ends once the
// full number of days has passed), expressed as a date so the expiry sweep can
// put it straight into a SQL comparison on the DATE column.
export function cooldownCutoffDate(now = Date.now(), cooldownDays = 90) {
  return new Date(now - cooldownDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}
