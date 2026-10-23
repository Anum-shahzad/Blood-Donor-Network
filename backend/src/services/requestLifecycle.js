// Request lifecycle rules that touch more than one table.
//
// 1. Expiry: a request stops being open once its needed-by time passes. A
//    request with no needed-by time stays open for REQUEST_DEFAULT_TTL_HOURS
//    (default 48h) after it was created, so stale emergencies never linger.
// 2. Closing: when a request is fulfilled, cancelled by its requester, or
//    rejected by an admin, every donor still committed to it is released,
//    otherwise they would stay locked to a closed request and never be matched
//    again. Both paths share one transactional routine (closeRequest below).
import { pool } from '../config/db.js';
import { decideClosure, donorOutcomeAfterRelease } from './requestClosureRules.js';
import { loadUnitProgress } from './requestUnits.js';

// Statuses the system may expire. 'donor_accepted' is deliberately excluded:
// a donor has committed and may already be on the way, so only the requester
// (or the donor cancelling) should close that one.
export const EXPIRABLE_STATUSES = ['pending', 'verified', 'matched'];

export function defaultTtlHours() {
  const n = Number(process.env.REQUEST_DEFAULT_TTL_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 48;
}

// SQL fragment: the moment a request stops being open. Takes one `?` param
// (the TTL in hours).
export const EFFECTIVE_EXPIRY_SQL = 'COALESCE(r.required_by, r.created_at + INTERVAL ? HOUR)';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function expireOverdueRequests() {
  const [result] = await pool.query(
    `UPDATE requests r
        SET r.status = 'expired'
      WHERE r.status IN (?)
        AND ${EFFECTIVE_EXPIRY_SQL} < NOW()`,
    [EXPIRABLE_STATUSES, defaultTtlHours()]
  );
  return result.affectedRows;
}

// Closes a request and releases its committed donors, all in ONE transaction.
//
// Lock order is request row first, then donor rows (ordered by id) — the same
// order acceptRequest and recordDonation use — so a close can't deadlock with,
// or interleave badly with, a donor accepting / cancelling / donating.
//
// - The status change is validated by decideClosure() under the request lock:
//   a fulfilled request can't be cancelled/rejected, a cancelled one can't be
//   fulfilled, an expired one is never rewritten. Repeating the same close is a
//   safe no-op (already_closed: true).
// - Donor release also runs on that no-op repeat, so a donor stranded on an
//   already-closed request by older code is freed by simply repeating the call.
//   It touches only donors whose committed_request_id is this request.
// - Each donor becomes AVAILABLE, or COOLDOWN if their last_donation_date is
//   still inside the cooldown (donorOutcomeAfterRelease). Every commitment
//   state is released, including DONATING and DONATION_COMPLETED.
// - A request can only be closed as 'fulfilled' once its confirmed donated
//   units meet units_needed; until then 'fulfilled' is refused (409) and the
//   request stays open for further donors. Cancelling is always allowed.
// - Every still-'accepted' response on the request becomes 'cancelled', so no
//   promised units outlive the request.
// - A pending donation claim ('claimed') is never wiped by a close. The
//   requester cannot cancel/close the request until every claim has been
//   confirmed or disputed (409), otherwise a legitimate dispute would become
//   impossible. An admin rejection keeps the claim but turns it into
//   'disputed' (never counted), so it stays on record for review.
// - We do NOT record a donation: "fulfilled"/"cancelled" proves nothing about
//   this donor, so donations, last_donation_date, blood-group verification and
//   the users table (suspension) are left untouched.
async function closeRequest({ requestId, requesterId = null, target, adminRejection = false }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      requesterId === null
        ? 'SELECT id, status, units_needed FROM requests WHERE id = ? FOR UPDATE'
        : 'SELECT id, status, units_needed FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE',
      requesterId === null ? [requestId] : [requestId, requesterId]
    );
    const existing = rows[0];
    if (!existing) {
      throw httpError(404, 'Request not found');
    }

    const decision = decideClosure(existing.status, target);
    if (!decision.ok) {
      throw httpError(decision.httpStatus, decision.reason);
    }

    const [pendingClaims] = await conn.query(
      `SELECT donor_id FROM request_responses WHERE request_id = ? AND status = 'claimed' FOR UPDATE`,
      [requestId]
    );
    if (pendingClaims.length > 0 && !adminRejection) {
      throw httpError(
        409,
        'A donor has claimed a donation on this request. Confirm it (Confirm Received) or mark it as Did Not Happen before closing the request'
      );
    }

    if (decision.action === 'apply' && target === 'fulfilled') {
      const progress = await loadUnitProgress(conn, requestId, existing.units_needed);
      if (progress.donated < progress.required) {
        throw httpError(
          409,
          `Only ${progress.donated} of ${progress.required} units have a confirmed donation — the request stays open until all units are donated`
        );
      }
    }

    if (decision.action === 'apply') {
      // The status guard repeats the check made under the lock; if it ever
      // fails we stop rather than report a change that did not happen.
      const [updated] = await conn.query(
        adminRejection
          ? 'UPDATE requests SET status = ?, is_verified = FALSE WHERE id = ? AND status = ?'
          : 'UPDATE requests SET status = ? WHERE id = ? AND status = ?',
        [target, requestId, existing.status]
      );
      if (updated.affectedRows !== 1) {
        throw httpError(409, 'Request was updated by someone else — please refresh and try again');
      }
    }

    // Admin rejection: pending claims are kept as 'disputed' (not donated, not
    // deleted) so they can still be reviewed.
    if (pendingClaims.length > 0) {
      await conn.query(
        `UPDATE request_responses
            SET status = 'disputed', claim_resolved_at = NOW(), confirmed_units = 0, responded_at = NOW()
          WHERE request_id = ? AND status = 'claimed'`,
        [requestId]
      );
    }

    await conn.query(
      `UPDATE request_responses SET status = 'cancelled', responded_at = NOW()
        WHERE request_id = ? AND status = 'accepted'`,
      [requestId]
    );

    const [committed] = await conn.query(
      `SELECT user_id, last_donation_date
         FROM donor_profiles
        WHERE committed_request_id = ?
        ORDER BY user_id
          FOR UPDATE`,
      [requestId]
    );

    let donorsReleased = 0;
    for (const donor of committed) {
      const outcome = donorOutcomeAfterRelease(donor.last_donation_date);
      // is_available is only forced off for a cooling-down donor (as
      // recordDonation does); for an eligible donor it is left as they set it.
      const [released] = await conn.query(
        `UPDATE donor_profiles
            SET current_status = ?,
                is_available = CASE WHEN ? THEN is_available ELSE FALSE END,
                cooldown_until = COALESCE(?, cooldown_until),
                committed_request_id = NULL,
                commitment_ended_at = NOW(),
                status_changed_at = NOW()
          WHERE user_id = ? AND committed_request_id = ?`,
        [outcome.current_status, outcome.keepIsAvailable, outcome.cooldown_until, donor.user_id, requestId]
      );
      donorsReleased += released.affectedRows;
    }

    await conn.commit();
    return {
      previous_status: existing.status,
      new_status: target,
      already_closed: decision.action === 'noop',
      donors_released: donorsReleased,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Requester fulfils or cancels their OWN request (404 for anyone else's).
export function closeRequestByRequester(requestId, requesterId, newStatus) {
  return closeRequest({ requestId, requesterId, target: newStatus });
}

// Admin rejects any request: it becomes 'cancelled' and un-verified. Allowed
// on live requests only; a fulfilled/expired request is refused (409) and an
// already-cancelled one is a safe no-op.
export function rejectRequestByAdmin(requestId) {
  return closeRequest({ requestId, target: 'cancelled', adminRejection: true });
}
