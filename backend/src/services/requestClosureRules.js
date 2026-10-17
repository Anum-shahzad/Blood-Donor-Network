// Pure decision rules for closing a blood request (L-02) — no DB access.
// requestLifecycle.js does the transactional read/write; this file only
// answers "is this status change allowed?" and "what should a released donor
// become?", so both can be unit-tested with plain values (same split as
// donorState.js / chatRules.js).
import { computeCooldownInfo } from './matching/donorState.js';
import { DONATION_COOLDOWN_DAYS } from '../utils/validation.js';

// A request in one of these statuses is still live and may be closed.
export const CLOSABLE_REQUEST_STATUSES = ['pending', 'verified', 'matched', 'donor_accepted'];
// Terminal statuses. Once here, a request's history is never rewritten.
export const TERMINAL_REQUEST_STATUSES = ['fulfilled', 'cancelled', 'expired'];
// What a close may settle a request into.
export const CLOSE_TARGET_STATUSES = ['fulfilled', 'cancelled'];

// Decides whether `currentStatus` may move to `target`.
//   { ok: true,  action: 'apply' }  -> change the status
//   { ok: true,  action: 'noop'  }  -> already there; repeating is safe and
//                                      changes nothing about the request
//   { ok: false, httpStatus, reason } -> refused, request left untouched
// Rules:
//   - live request          -> may become fulfilled or cancelled
//   - already == target     -> idempotent no-op (a double click or retry)
//   - any other terminal    -> refused: a fulfilled request can't be cancelled
//                              or rejected, a cancelled one can't be fulfilled,
//                              an expired one can't be rewritten
export function decideClosure(currentStatus, target) {
  if (!CLOSE_TARGET_STATUSES.includes(target)) {
    return { ok: false, httpStatus: 400, reason: `status must be one of: ${CLOSE_TARGET_STATUSES.join(', ')}` };
  }
  if (currentStatus === target) {
    return { ok: true, action: 'noop' };
  }
  if (CLOSABLE_REQUEST_STATUSES.includes(currentStatus)) {
    return { ok: true, action: 'apply' };
  }
  return {
    ok: false,
    httpStatus: 409,
    reason: TERMINAL_REQUEST_STATUSES.includes(currentStatus)
      ? `Request is already ${currentStatus} and cannot be changed to ${target}`
      : `Request is ${currentStatus} and cannot be changed to ${target}`,
  };
}

// What a donor becomes when the request they were committed to is closed.
// Driven only by the donor's own last_donation_date and the existing cooldown
// rule (computeCooldownInfo / DONATION_COOLDOWN_DAYS), the same one
// recordDonation and the cooldown sweep use:
//   - cooldown over (or no donation on record) -> AVAILABLE. is_available is
//     left exactly as the donor set it (keepIsAvailable).
//   - still inside the cooldown                -> COOLDOWN, is_available off and
//     cooldown_until set, exactly as recordDonation leaves a cooling-down donor;
//     the existing sweep returns them to AVAILABLE when it ends.
export function donorOutcomeAfterRelease(lastDonationDate, cooldownDays = DONATION_COOLDOWN_DAYS) {
  const info = computeCooldownInfo(lastDonationDate, cooldownDays);
  if (info.isEligible) {
    return { current_status: 'AVAILABLE', keepIsAvailable: true, cooldown_until: null };
  }
  return { current_status: 'COOLDOWN', keepIsAvailable: false, cooldown_until: info.cooldownUntil };
}
