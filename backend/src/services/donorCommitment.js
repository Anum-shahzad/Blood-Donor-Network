// Transactional donor commitment operations. This is the ONLY place that
// writes to donor_profiles.current_status or moves a request into/out of
// 'donor_accepted' — routes call these functions instead of running their
// own UPDATE statements, so the concurrency guarantees below can't be
// bypassed by a future route added elsewhere.
//
// A request may have several donors at once. Each donor's promise
// (request_responses.committed_units, status 'accepted') and confirmed
// donation (confirmed_units, status 'donated') are separate; a request is
// fulfilled only when confirmed units reach units_needed (requestUnits.js).
//
// Every operation here takes out row locks (SELECT ... FOR UPDATE) inside a
// transaction before deciding anything, so two simultaneous accept attempts
// on the same request (or the same donor accepting two requests at once)
// serialize on the lock instead of racing. Decisions themselves are made by
// the pure rules in matching/donorState.js — this file is only the
// transaction/locking wrapper around them.
import { pool } from '../config/db.js';
import {
  canDonorAccept,
  canRequestAcceptDonor,
  canDonorCancelCommitment,
  canDonorAdvanceJourney,
  computeCooldownInfo,
  cooldownCutoffDate,
  requestStatusAfterAccept,
} from './matching/donorState.js';
import { canDonorGiveToRecipient } from './matching/compatibility.js';
import { isEligibleByRecency, DONATION_COOLDOWN_MONTHS } from './matching/donorMatching.js';
import { upsertConversation } from './chatService.js';
import { loadUnitProgress, settleRequestStatus } from './requestUnits.js';
import { donorOutcomeAfterRelease } from './requestClosureRules.js';
import { defaultTtlHours } from './requestLifecycle.js';
import { validateDonationDate, daysBetween, DONATION_COOLDOWN_DAYS } from '../utils/validation.js';
import { assertDonorMeetsDonationLevel } from './verification/verificationService.js';
import { createRequesterNotification, NOTIFICATION_TYPE_DONOR_STATUS } from './notifications/notificationService.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Most units one donor may promise on a single request.
const MAX_UNITS_PER_COMMITMENT = 2;
// Response states in which this donor may not accept the same request again.
const NO_REACCEPT_RESPONSE_STATES = ['accepted', 'claimed', 'donated', 'failed', 'disputed'];

// Donor accepts a specific request. Verifies eligibility, verifies the
// donor is still available, verifies the request is open AND still has units
// nobody has donated or promised, then atomically commits the donor and
// records the response — all inside one transaction. The request row lock
// serializes every donor competing for the same units, so two simultaneous
// accepts can never promise more units than remain, and the donor row lock
// plus the (request_id, donor_id) unique key stop a duplicate commitment.
export async function acceptRequest(donorId, requestId, { units = 1 } = {}) {
  const requestedUnits = units == null || units === '' ? 1 : Number(units);
  if (!Number.isInteger(requestedUnits) || requestedUnits < 1 || requestedUnits > MAX_UNITS_PER_COMMITMENT) {
    throw httpError(400, `units must be a whole number between 1 and ${MAX_UNITS_PER_COMMITMENT}`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [requestRows] = await conn.query('SELECT * FROM requests WHERE id = ? FOR UPDATE', [requestId]);
    const request = requestRows[0];

    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];

    const progress = request ? await loadUnitProgress(conn, requestId, request.units_needed) : null;
    const requestCheck = canRequestAcceptDonor(request, progress);
    if (!requestCheck.ok) {
      throw httpError(request ? 409 : 404, requestCheck.reason);
    }

    // The donor must have an admin-approved identity (verification Level 3 or
    // higher). Checked on the server inside the transaction, from the same
    // database rows the badge uses, so calling this endpoint directly cannot
    // bypass it. Level 1 (registered) and Level 2 (pending) are refused.
    await assertDonorMeetsDonationLevel(donorId, conn);

    // Verification is enforced here, on the server, under the request row
    // lock: an admin-unverified (or never-verified) request cannot be
    // accepted even if its status column still says verified/matched.
    if (!request.is_verified) {
      throw httpError(409, 'This request has not been verified by an admin and cannot be accepted');
    }

    // Same expiry rule the open-request list and the expiry sweep use:
    // needed-by time, or created_at + the default TTL when none was set.
    const expiresAt = request.required_by
      ? new Date(request.required_by).getTime()
      : new Date(request.created_at).getTime() + defaultTtlHours() * 60 * 60 * 1000;
    if (expiresAt < Date.now()) {
      throw httpError(409, request.required_by
        ? 'This request has passed its needed-by time'
        : 'This request has expired');
    }

    const donorCheck = canDonorAccept(donorProfile);
    if (!donorCheck.ok) {
      throw httpError(donorProfile ? 409 : 404, donorCheck.reason);
    }

    if (!canDonorGiveToRecipient(donorProfile.blood_group, request.blood_group)) {
      throw httpError(409, 'Your blood group is not compatible with this request');
    }

    if (!isEligibleByRecency(donorProfile.last_donation_date)) {
      throw httpError(
        409,
        `You are still inside the ${DONATION_COOLDOWN_MONTHS}-month post-donation cooldown`
      );
    }

    // One commitment per donor per request.
    const [existingRows] = await conn.query(
      'SELECT status FROM request_responses WHERE request_id = ? AND donor_id = ? FOR UPDATE',
      [requestId, donorId]
    );
    if (existingRows[0] && NO_REACCEPT_RESPONSE_STATES.includes(existingRows[0].status)) {
      throw httpError(409, existingRows[0].status === 'accepted'
        ? 'You have already accepted this request'
        : `Your earlier response to this request is ${existingRows[0].status}, so it cannot be accepted again`);
    }

    // Never promise more than is still unallocated.
    const committedUnits = Math.min(requestedUnits, progress.open);
    const newRequestStatus = requestStatusAfterAccept();

    // Re-check the affected row count on every write — belt-and-braces
    // against a lock somehow not covering a concurrent change, so we never
    // report success without having actually moved the rows.
    if (request.status !== newRequestStatus) {
      const [requestUpdate] = await conn.query(
        `UPDATE requests SET status = ? WHERE id = ? AND status = ?`,
        [newRequestStatus, requestId, request.status]
      );
      if (requestUpdate.affectedRows === 0) {
        throw httpError(409, 'Request was updated by someone else — please refresh and try again');
      }
    }

    const [donorUpdate] = await conn.query(
      `UPDATE donor_profiles
         SET current_status = 'COMMITTED',
             committed_request_id = ?,
             commitment_started_at = NOW(),
             commitment_ended_at = NULL,
             status_changed_at = NOW()
       WHERE user_id = ? AND current_status = 'AVAILABLE'`,
      [requestId, donorId]
    );
    if (donorUpdate.affectedRows === 0) {
      throw httpError(409, 'Your status changed before this could complete — please try again');
    }

    await conn.query(
      `INSERT INTO request_responses (request_id, donor_id, status, committed_units, confirmed_units, responded_at)
       VALUES (?, ?, 'accepted', ?, 0, NOW())
       ON DUPLICATE KEY UPDATE status = 'accepted', committed_units = VALUES(committed_units),
                               confirmed_units = 0, responded_at = NOW()`,
      [requestId, donorId, committedUnits]
    );

    // Open this donor's private chat with the requester in the same
    // transaction, so a successful accept always has a conversation and a
    // failed one leaves nothing behind. Chat is coordination only.
    await upsertConversation(conn, {
      requestId,
      donorId,
      requesterId: request.requester_id,
    });

    await conn.commit();
    return {
      request_id: requestId,
      request_status: newRequestStatus,
      donor_status: 'COMMITTED',
      committed_units: committedUnits,
      units_required: progress.required,
      units_donated: progress.donated,
      units_committed: progress.committed + committedUnits,
      units_remaining: progress.remaining,
      units_open: progress.open - committedUnits,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Donor declines a specific request. This never changes donor_profiles or
// requests — it only records that this donor was offered the request and
// said no, so they aren't re-offered it and the requester can see the
// response count. It doesn't require the row locks acceptRequest does
// because it can't conflict with anything else.
export async function declineRequest(donorId, requestId) {
  const [requestRows] = await pool.query('SELECT id, status FROM requests WHERE id = ?', [requestId]);
  if (requestRows.length === 0) {
    throw httpError(404, 'Request not found');
  }

  // A donor who is currently committed to this very request must cancel the
  // commitment instead — "declining" it would leave them locked to it while
  // the response row says they said no.
  const [donorRows] = await pool.query(
    'SELECT committed_request_id FROM donor_profiles WHERE user_id = ?',
    [donorId]
  );
  if (donorRows[0] && Number(donorRows[0].committed_request_id) === Number(requestId)) {
    throw httpError(409, 'You are committed to this request — cancel your commitment instead');
  }

  await pool.query(
    `INSERT INTO request_responses (request_id, donor_id, status, responded_at)
     VALUES (?, ?, 'declined', NOW())
     ON DUPLICATE KEY UPDATE status = 'declined', responded_at = NOW()`,
    [requestId, donorId]
  );

  return { request_id: requestId, donor_response: 'declined' };
}

// Donor backs out of a commitment before travelling. Returns the donor to
// AVAILABLE and reopens the request to active matching. Only legal from
// COMMITTED — once a donor is EN_ROUTE or further along, cancellation is a
// different (later-phase) operation with its own consequences.
export async function cancelCommitment(donorId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the request row BEFORE the donor row (same order as acceptRequest,
    // recordDonation and the request-closing routine), so this can't deadlock
    // with a requester/admin closing the same request. The commitment is
    // re-verified once both locks are held.
    const [peekRows] = await conn.query(
      'SELECT committed_request_id FROM donor_profiles WHERE user_id = ?',
      [donorId]
    );
    const peekedRequestId = peekRows[0]?.committed_request_id || null;
    if (peekedRequestId) {
      await conn.query('SELECT id FROM requests WHERE id = ? FOR UPDATE', [peekedRequestId]);
    }

    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];

    const cancelCheck = canDonorCancelCommitment(donorProfile);
    if (!cancelCheck.ok) {
      throw httpError(donorProfile ? 409 : 404, cancelCheck.reason);
    }
    if ((donorProfile.committed_request_id || null) !== peekedRequestId) {
      throw httpError(409, 'Your commitment changed while saving — please refresh and try again');
    }

    const requestId = donorProfile.committed_request_id;

    if (requestId) {
      // Record the withdrawal so this donor's promised units drop out of the
      // committed total and become available to other donors again.
      await conn.query(
        `UPDATE request_responses SET status = 'cancelled', responded_at = NOW()
          WHERE request_id = ? AND donor_id = ? AND status = 'accepted'`,
        [requestId, donorId]
      );
      // The request stays 'donor_accepted' while other donors are still
      // committed, and only reopens to 'matched' when this was the last one.
      const [reqRows] = await conn.query('SELECT * FROM requests WHERE id = ?', [requestId]);
      if (reqRows[0]) await settleRequestStatus(conn, reqRows[0]);
    }

    await conn.query(
      `UPDATE donor_profiles
         SET current_status = 'AVAILABLE',
             committed_request_id = NULL,
             commitment_ended_at = NOW(),
             status_changed_at = NOW()
       WHERE user_id = ?`,
      [donorId]
    );

    await conn.commit();
    return { donor_status: 'AVAILABLE', reopened_request_id: requestId || null };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// A committed donor's donation did not happen or did not succeed (no-show,
// deferred at screening, collection failed). Reported by the requester for any
// of their request's committed donors, or by the donor for their own
// commitment. The donor's promised units drop out of the committed total, so
// they become available to other donors again; nothing is recorded as donated,
// and no cooldown is started (the donor returns to AVAILABLE, or to COOLDOWN
// only if an earlier donation still has one running — same rule as closing a
// request). Lock order: request row, then donor row.
export async function markCommitmentUnsuccessful({ requestId, donorId, requesterId = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [requestRows] = await conn.query(
      requesterId === null
        ? 'SELECT * FROM requests WHERE id = ? FOR UPDATE'
        : 'SELECT * FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE',
      requesterId === null ? [requestId] : [requestId, requesterId]
    );
    const request = requestRows[0];
    if (!request) {
      throw httpError(404, 'Request not found');
    }

    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];

    const [responseRows] = await conn.query(
      `SELECT status FROM request_responses WHERE request_id = ? AND donor_id = ? FOR UPDATE`,
      [requestId, donorId]
    );
    if (!responseRows[0] || responseRows[0].status !== 'accepted') {
      throw httpError(409, 'This donor has no active commitment on this request');
    }

    await conn.query(
      `UPDATE request_responses SET status = 'failed', confirmed_units = 0, responded_at = NOW()
        WHERE request_id = ? AND donor_id = ? AND status = 'accepted'`,
      [requestId, donorId]
    );

    // Free the donor only if they are still tied to THIS request.
    if (donorProfile && Number(donorProfile.committed_request_id) === Number(requestId)) {
      const outcome = donorOutcomeAfterRelease(donorProfile.last_donation_date);
      await conn.query(
        `UPDATE donor_profiles
            SET current_status = ?,
                is_available = CASE WHEN ? THEN is_available ELSE FALSE END,
                cooldown_until = COALESCE(?, cooldown_until),
                committed_request_id = NULL,
                commitment_ended_at = NOW(),
                status_changed_at = NOW()
          WHERE user_id = ? AND committed_request_id = ?`,
        [outcome.current_status, outcome.keepIsAvailable, outcome.cooldown_until, donorId, requestId]
      );
    }

    const { progress, status } = await settleRequestStatus(conn, request);

    await conn.commit();
    return {
      request_id: requestId,
      donor_id: donorId,
      request_status: status,
      units_required: progress.required,
      units_donated: progress.donated,
      units_committed: progress.committed,
      units_remaining: progress.remaining,
      units_open: progress.open,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Donor reports that their own donation was unsuccessful.
export async function reportDonationUnsuccessful(donorId) {
  const [rows] = await pool.query(
    'SELECT committed_request_id FROM donor_profiles WHERE user_id = ?',
    [donorId]
  );
  const requestId = rows[0]?.committed_request_id;
  if (!requestId) {
    throw httpError(409, 'You have no active commitment');
  }
  return markCommitmentUnsuccessful({ requestId, donorId });
}

// Donor advances their journey: COMMITTED -> EN_ROUTE -> ARRIVED, in that order
// (rules in canDonorAdvanceJourney). The last step, Donation Claimed, is not a
// plain step; it goes through claimDonation() (services/donationClaims.js)
// because the requester has to confirm it.
//
// The requester is notified of EN_ROUTE and ARRIVED in the SAME transaction as
// the status change, so the two are saved together or not at all. The
// notification's unique dedupe key means the same change can never notify twice.
// Lock order matches acceptRequest: request row, then donor row.
export async function advanceCommitmentStep(donorId, nextStep) {
  if (nextStep === 'DONATING' || nextStep === 'DONATION_COMPLETED') {
    throw httpError(409, 'Use Mark as Donated to claim a donation; the requester has to confirm it before it counts');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [peekRows] = await conn.query(
      'SELECT committed_request_id FROM donor_profiles WHERE user_id = ?',
      [donorId]
    );
    const peekedRequestId = peekRows[0]?.committed_request_id || null;
    let request = null;
    if (peekedRequestId) {
      const [requestRows] = await conn.query('SELECT * FROM requests WHERE id = ? FOR UPDATE', [peekedRequestId]);
      request = requestRows[0] || null;
    }

    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];
    // Moving a commitment forward is part of taking part in a donation, so the
    // same Level 3 minimum applies. Cancelling a commitment stays available.
    await assertDonorMeetsDonationLevel(donorId, conn);
    const check = canDonorAdvanceJourney(donorProfile, nextStep);
    if (!check.ok) {
      throw httpError(409, check.reason);
    }
    if ((donorProfile.committed_request_id || null) !== peekedRequestId || !request) {
      throw httpError(409, 'Your commitment changed while saving — please refresh and try again');
    }
    if (request.status !== 'donor_accepted') {
      throw httpError(409, `This request is ${request.status}, so your status can no longer be updated`);
    }
    const [accepted] = await conn.query(
      `SELECT 1 FROM request_responses WHERE request_id = ? AND donor_id = ? AND status = 'accepted' FOR UPDATE`,
      [request.id, donorId]
    );
    if (accepted.length === 0) {
      throw httpError(409, 'You do not have an active commitment on this request');
    }

    // The WHERE re-checks the state that was validated above.
    const [moved] = await conn.query(
      `UPDATE donor_profiles
         SET current_status = ?,
             status_changed_at = NOW()
       WHERE user_id = ? AND current_status = ?`,
      [nextStep, donorId, donorProfile.current_status]
    );
    if (moved.affectedRows !== 1) {
      throw httpError(409, 'Your status changed before this could complete — please refresh and try again');
    }

    const notification = await createRequesterNotification(conn, {
      requesterId: request.requester_id,
      requestId: request.id,
      donorId,
      type: NOTIFICATION_TYPE_DONOR_STATUS,
      state: nextStep,
      commitmentStartedAt: donorProfile.commitment_started_at,
    });

    await conn.commit();
    return {
      donor_status: nextStep,
      request_id: donorProfile.committed_request_id,
      requester_notified: notification.created,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// One donation = one unit of whole blood. A little headroom is allowed for
// apheresis-style records; anything above is rejected, not trusted.
const MAX_UNITS_PER_DONATION = 2;

// Records a PAST donation made elsewhere (a plain history entry) and starts the
// 90-day cooldown for it. It is never tied to a blood request any more:
//   - A donor with an active commitment cannot use this at all. A donation for
//     a request is claimed with claimDonation() and only counts once the
//     requester confirms it (services/donationClaims.js), so this path can no
//     longer fulfil a request, count units as sourced or bypass confirmation.
//   - A client-sent request_id is refused (409) for the same reason.
//   - The date must be a real, non-future date, must sit at least 90 days away
//     from every donation already on record and from last_donation_date.
//   - last_donation_date can only move forward, never backwards, so logging
//     (or back-dating) a record can never shorten an existing cooldown.
export async function recordDonation(donorId, { donation_date, hospital_name, recipient_case, units = 1, request_id = null }) {
  const dateError = validateDonationDate(donation_date, 'donation_date');
  if (dateError) throw httpError(400, dateError);

  if (typeof hospital_name !== 'string' || !hospital_name.trim()) {
    throw httpError(400, 'hospital_name is required');
  }
  if (hospital_name.trim().length > 190) {
    throw httpError(400, 'hospital_name must be 190 characters or fewer');
  }
  if (recipient_case != null && typeof recipient_case !== 'string') {
    throw httpError(400, 'recipient_case must be text');
  }
  if (recipient_case && recipient_case.trim().length > 255) {
    throw httpError(400, 'recipient_case must be 255 characters or fewer');
  }
  const unitCount = units == null || units === '' ? 1 : Number(units);
  if (!Number.isInteger(unitCount) || unitCount < 1 || unitCount > MAX_UNITS_PER_DONATION) {
    throw httpError(400, `units must be a whole number between 1 and ${MAX_UNITS_PER_DONATION}`);
  }
  if (request_id != null && request_id !== '') {
    throw httpError(409, 'A donation for a request is claimed with Mark as Donated and counts once the requester confirms it');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];
    if (!donorProfile || !donorProfile.blood_group) {
      throw httpError(400, 'Set your blood group first before logging a donation');
    }
    if (donorProfile.committed_request_id) {
      throw httpError(409, 'You have an active commitment. Use Mark as Donated on it; the requester has to confirm the donation before it counts');
    }

    // --- cooldown: keep every donation >= 90 days apart ---------------------
    const [priorRows] = await conn.query('SELECT donation_date FROM donations WHERE donor_id = ?', [donorId]);
    const knownDates = priorRows.map((r) => String(r.donation_date).slice(0, 10));
    const profileLast = donorProfile.last_donation_date ? String(donorProfile.last_donation_date).slice(0, 10) : null;
    if (profileLast) knownDates.push(profileLast);
    for (const known of knownDates) {
      if (Math.abs(daysBetween(known, donation_date)) < DONATION_COOLDOWN_DAYS) {
        throw httpError(
          409,
          `This date is within ${DONATION_COOLDOWN_DAYS} days of your donation on ${known}. Donations must be at least ${DONATION_COOLDOWN_DAYS} days apart.`
        );
      }
    }

    // last_donation_date only ever moves forward.
    const isNewest = !profileLast || donation_date > profileLast;
    const effectiveLast = isNewest ? donation_date : profileLast;
    const cooldownInfo = computeCooldownInfo(effectiveLast, DONATION_COOLDOWN_DAYS);

    const [donationInsert] = await conn.query(
      `INSERT INTO donations (donor_id, request_id, donation_date, hospital_name, units, blood_group, recipient_case, is_verified)
       VALUES (?, NULL, ?, ?, ?, ?, ?, FALSE)`,
      [
        donorId,
        donation_date,
        hospital_name.trim(),
        unitCount,
        donorProfile.blood_group,
        recipient_case && recipient_case.trim() ? recipient_case.trim() : null,
      ]
    );

    // A history entry older than the donation already on file changes nothing
    // about the donor's current state or cooldown.
    if (!isNewest) {
      await conn.commit();
      return {
        donation_id: donationInsert.insertId,
        donor_status: donorProfile.current_status,
        is_available: Boolean(donorProfile.is_available),
        cooldown_until: cooldownInfo.cooldownUntil,
        days_remaining: cooldownInfo.daysRemaining,
        is_eligible: cooldownInfo.isEligible,
      };
    }

    const nextStatus = cooldownInfo.isEligible ? 'AVAILABLE' : 'COOLDOWN';
    const nextIsAvailable = cooldownInfo.isEligible ? Boolean(donorProfile.is_available) : false;

    await conn.query(
      `UPDATE donor_profiles
         SET last_donation_date = ?,
             cooldown_until = ?,
             current_status = ?,
             is_available = ?,
             status_changed_at = NOW()
       WHERE user_id = ?`,
      [effectiveLast, cooldownInfo.cooldownUntil, nextStatus, nextIsAvailable, donorId]
    );

    await conn.commit();
    return {
      donation_id: donationInsert.insertId,
      donor_status: nextStatus,
      is_available: nextIsAvailable,
      cooldown_until: cooldownInfo.cooldownUntil,
      days_remaining: cooldownInfo.daysRemaining,
      is_eligible: cooldownInfo.isEligible,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Returns donors to AVAILABLE once their post-donation cooldown has elapsed.
//
// recordDonation() is the only thing that puts a donor into COOLDOWN (and it
// also switches is_available off), and every eligibility gate trusts that
// stored state, so without this the state outlives the date and the donor stays
// locked out until they log another donation. The expiry sweep calls this.
//
// One UPDATE, so it is atomic, idempotent and safe if several serverless
// instances run it at once (the second finds nothing left to change). A donor is
// only released when ALL of these hold, so no other restriction is overridden:
//   - current_status is COOLDOWN (every other state, including an active
//     commitment or DONATION_COMPLETED, is left exactly as it is);
//   - they hold no commitment (committed_request_id IS NULL);
//   - last_donation_date is known and the cooldown has really elapsed (a missing
//     date is never treated as "expired");
//   - the account is a donor and is not suspended (suspension lives on users).
// is_available is switched back on because recordDonation switched it off for
// the cooldown. Blood-group verification is not read or changed.
//
// Plain-SQL comparisons only (no date functions, no array params): the cutoff is
// computed in JS from the same rule computeCooldownInfo() uses, so the DATE
// comparison behaves identically on MySQL and TiDB regardless of session time zone.
export async function releaseExpiredCooldowns(now = Date.now()) {
  const [result] = await pool.query(
    `UPDATE donor_profiles
        SET current_status = 'AVAILABLE',
            is_available = TRUE,
            status_changed_at = NOW()
      WHERE current_status = 'COOLDOWN'
        AND committed_request_id IS NULL
        AND last_donation_date IS NOT NULL
        AND last_donation_date <= ?
        AND user_id IN (
          SELECT id FROM users
           WHERE role = 'donor' AND COALESCE(is_suspended, FALSE) = FALSE
        )`,
    [cooldownCutoffDate(now, DONATION_COOLDOWN_DAYS)]
  );
  return result.affectedRows;
}
