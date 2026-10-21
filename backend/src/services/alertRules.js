// Urgent-alert validation rules — pure decision logic, no DB access.
// Kept separate from the route (routes/requests.js does the queries and the
// transaction) so every rule can be unit-tested with plain objects, the same
// way donorState.js and compatibility.js are.
//
// The rules deliberately mirror what acceptRequest() enforces for a donor
// accepting a request: an alert should only ever go to a donor who could
// actually accept that request right now.
import { canDonorGiveToRecipient } from './matching/compatibility.js';
import { isEligibleByRecency } from './matching/donorMatching.js';
import { canDonorAccept, REQUEST_STATUSES_OPEN_FOR_ACCEPT } from './matching/donorState.js';
import { meetsDonationLevel } from './verification/verificationRules.js';

// users.id / requests.id are INT columns.
const MAX_DB_INT = 2147483647;

// Parses a URL id segment. Returns a positive integer, or null when the value
// is anything else. Stricter than Number()+isInteger, which also accepts
// '' (0), '-1', '1e3', '0x10', ' 7 ', and values beyond the INT column range.
export function parseIdParam(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_DB_INT ? n : null;
}

// Donor-side failures all share one message on purpose. A requester can type
// any numeric id, so distinct errors ("not a donor", "suspended", "unavailable",
// "declined") would let them probe which accounts are donors and what those
// donors are doing. The UI only offers the alert button for donors returned by
// the match list, so legitimate use never reaches this message.
export const DONOR_NOT_AVAILABLE_MESSAGE = 'Donor not available';

const deny = (status, message) => ({ ok: false, status, message });

// request:         the requester's own request row (ownership already checked by the query)
// donorAccount:    users row for the target id (or undefined)
// donorProfile:    donor_profiles row for the target id (or undefined)
// existingResponse: request_responses row for (request, donor), or undefined
// donorVerificationLevel: the donor's derived verification level (1-5). Below
//                  Level 3 the donor cannot accept, so they are never alerted.
//                  Missing means not verified (fails closed).
// ttlHours:        default request lifetime when no needed-by time was set
// now:             ms timestamp, injectable for tests
export function evaluateAlert({ request, donorAccount, donorProfile, donorVerificationLevel, existingResponse, ttlHours, now = Date.now() }) {
  // ---- the request must be open, verified and not expired ----------------
  if (!request) return deny(404, 'Request not found');

  if (!request.is_verified) {
    return deny(409, 'This request has not been verified by an admin yet, so donors cannot be alerted');
  }
  if (!REQUEST_STATUSES_OPEN_FOR_ACCEPT.includes(request.status)) {
    return deny(409, `This request is ${request.status} and is no longer open for alerts`);
  }
  const expiresAt = request.required_by
    ? new Date(request.required_by).getTime()
    : new Date(request.created_at).getTime() + ttlHours * 60 * 60 * 1000;
  if (Number.isNaN(expiresAt) || expiresAt < now) {
    return deny(409, request.required_by
      ? 'This request has passed its needed-by time'
      : 'This request has expired');
  }

  // ---- the target must be an active donor who could accept it -----------
  if (!donorAccount || donorAccount.role !== 'donor' || donorAccount.is_suspended) {
    return deny(404, DONOR_NOT_AVAILABLE_MESSAGE);
  }
  if (!canDonorAccept(donorProfile).ok) {
    return deny(404, DONOR_NOT_AVAILABLE_MESSAGE);
  }
  // Same Level 3 minimum acceptRequest() enforces. Same generic message so a
  // requester cannot learn anything about a donor's verification state.
  if (!meetsDonationLevel(donorVerificationLevel)) {
    return deny(404, DONOR_NOT_AVAILABLE_MESSAGE);
  }
  if (!canDonorGiveToRecipient(donorProfile.blood_group, request.blood_group)) {
    return deny(404, DONOR_NOT_AVAILABLE_MESSAGE);
  }
  if (!isEligibleByRecency(donorProfile.last_donation_date)) {
    return deny(404, DONOR_NOT_AVAILABLE_MESSAGE);
  }

  // ---- never overwrite an earlier response -------------------------------
  if (existingResponse) {
    if (existingResponse.status === 'notified') {
      return deny(409, 'This donor has already been alerted for this request');
    }
    // 'declined' / 'accepted': the donor's own answer stands; an alert must not undo it.
    return deny(404, DONOR_NOT_AVAILABLE_MESSAGE);
  }

  return { ok: true };
}
