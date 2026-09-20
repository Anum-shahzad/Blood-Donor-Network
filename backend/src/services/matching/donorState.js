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
// matching donors against it.
export const REQUEST_STATUSES_OPEN_FOR_ACCEPT = ['verified', 'matched'];

// Statuses a request settles into once a donor has committed — no other
// donor can accept a request that has already reached one of these.
export const REQUEST_STATUSES_CLOSED_FOR_ACCEPT = [
  'donor_accepted',
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

// A request can only take a new commitment while it's actually open. Once
// another donor has already been accepted (or the request closed for any
// other reason), a second accept must fail safely rather than silently
// double-booking the request.
export function canRequestAcceptDonor(request) {
  if (!request) {
    return { ok: false, reason: 'Request not found' };
  }
  if (REQUEST_STATUSES_CLOSED_FOR_ACCEPT.includes(request.status)) {
    return { ok: false, reason: `This request is already ${request.status} — nothing left to accept` };
  }
  if (!REQUEST_STATUSES_OPEN_FOR_ACCEPT.includes(request.status)) {
    return { ok: false, reason: 'This request is not open for donor responses yet' };
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

// What the request's status should become once a donor commits. Kept as a
// pure lookup so the transition is documented in exactly one place.
export function requestStatusAfterAccept() {
  return 'donor_accepted';
}

// What a request reopens to when its committed donor cancels. It goes back
// to 'matched' (not 'verified') because it has already been through the
// matching step at least once and should return straight to active
// matching rather than the verification queue.
export function requestStatusAfterCommitmentCancelled() {
  return 'matched';
}
