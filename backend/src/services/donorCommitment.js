// Transactional donor commitment operations. This is the ONLY place that
// writes to donor_profiles.current_status or moves a request into/out of
// 'donor_accepted' — routes call these functions instead of running their
// own UPDATE statements, so the concurrency guarantees below can't be
// bypassed by a future route added elsewhere.
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
  requestStatusAfterAccept,
  requestStatusAfterCommitmentCancelled,
} from './matching/donorState.js';
import { canDonorGiveToRecipient } from './matching/compatibility.js';
import { isEligibleByRecency, DONATION_COOLDOWN_MONTHS } from './matching/donorMatching.js';
import { upsertConversation } from './chatService.js';
import { defaultTtlHours } from './requestLifecycle.js';
import { validateDonationDate, daysBetween, DONATION_COOLDOWN_DAYS } from '../utils/validation.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Donor accepts a specific request. Verifies eligibility, verifies the
// donor is still available, verifies the request is still open, then
// atomically commits the donor and records the response — all inside one
// transaction so a second, simultaneous accept (by this donor on another
// request, or by another donor on this same request) safely fails instead
// of producing an inconsistent state.
export async function acceptRequest(donorId, requestId) {
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

    const requestCheck = canRequestAcceptDonor(request);
    if (!requestCheck.ok) {
      throw httpError(request ? 409 : 404, requestCheck.reason);
    }

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

    const newRequestStatus = requestStatusAfterAccept();

    // Re-check the affected row count on both writes — belt-and-braces
    // against a lock somehow not covering a concurrent change, so we never
    // report success without having actually moved both rows.
    const [requestUpdate] = await conn.query(
      `UPDATE requests SET status = ? WHERE id = ? AND status = ?`,
      [newRequestStatus, requestId, request.status]
    );
    if (requestUpdate.affectedRows === 0) {
      throw httpError(409, 'Request was updated by someone else — please refresh and try again');
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
      `INSERT INTO request_responses (request_id, donor_id, status, responded_at)
       VALUES (?, ?, 'accepted', NOW())
       ON DUPLICATE KEY UPDATE status = 'accepted', responded_at = NOW()`,
      [requestId, donorId]
    );

    // Open the private donor<->requester chat in the same transaction, so a
    // successful accept always has a conversation and a failed one leaves
    // nothing behind. Chat is coordination only — it does not affect state.
    await upsertConversation(conn, {
      requestId,
      donorId,
      requesterId: request.requester_id,
    });

    await conn.commit();
    return { request_id: requestId, request_status: newRequestStatus, donor_status: 'COMMITTED' };
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

    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];

    const cancelCheck = canDonorCancelCommitment(donorProfile);
    if (!cancelCheck.ok) {
      throw httpError(donorProfile ? 409 : 404, cancelCheck.reason);
    }

    const requestId = donorProfile.committed_request_id;
    const newRequestStatus = requestStatusAfterCommitmentCancelled();

    if (requestId) {
      await conn.query(
        `UPDATE requests SET status = ? WHERE id = ? AND status = 'donor_accepted'`,
        [newRequestStatus, requestId]
      );
      // Record the withdrawal so this donor's response no longer reads
      // 'accepted' for a request they backed out of.
      await conn.query(
        `UPDATE request_responses SET status = 'declined', responded_at = NOW()
          WHERE request_id = ? AND donor_id = ?`,
        [requestId, donorId]
      );
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

// Donor advances journey step (COMMITTED -> EN_ROUTE -> ARRIVED -> DONATING)
export async function advanceCommitmentStep(donorId, nextStep) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [donorRows] = await conn.query(
      'SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE',
      [donorId]
    );
    const donorProfile = donorRows[0];
    const check = canDonorAdvanceJourney(donorProfile, nextStep);
    if (!check.ok) {
      throw httpError(409, check.reason);
    }

    await conn.query(
      `UPDATE donor_profiles
         SET current_status = ?,
             status_changed_at = NOW()
       WHERE user_id = ?`,
      [nextStep, donorId]
    );

    await conn.commit();
    return { donor_status: nextStep, request_id: donorProfile.committed_request_id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Donor-journey states in which a donor is genuinely mid-commitment and so
// may log the donation for the request they accepted.
const DONATION_LOGGABLE_STATES = ['COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED'];
// One donation = one unit of whole blood. A little headroom is allowed for
// apheresis-style records; anything above is rejected, not trusted.
const MAX_UNITS_PER_DONATION = 2;

// Records a donation and starts the 90-day cooldown. Every rule is enforced
// here, on the server, regardless of what the frontend sent:
//   - The request a donation is attached to is NEVER taken from the client.
//     It is the donor's own committed request, and only if that request is
//     still 'donor_accepted' and this donor holds its 'accepted' response.
//     A client-sent request_id is accepted only as a consistency check — if
//     it differs from the server-side commitment the call is rejected.
//   - One donation record per donor per request (checked under the donor
//     row lock, and backed by an optional unique index — migration 005).
//   - The date must be a real, non-future date, must not predate the
//     commitment, and must sit at least 90 days away from every donation
//     already on record and from the profile's last_donation_date.
//   - last_donation_date can only move forward, never backwards, so logging
//     (or back-dating) a record can never shorten an existing cooldown.
//
// Lock order matches acceptRequest: request row first, then donor row.
export async function recordDonation(donorId, { donation_date, hospital_name, recipient_case, units = 1, request_id = null }) {
  // --- input validation (no DB needed) -----------------------------------
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
  let claimedRequestId = null;
  if (request_id != null && request_id !== '') {
    claimedRequestId = Number(request_id);
    if (!Number.isInteger(claimedRequestId) || claimedRequestId < 1) {
      throw httpError(400, 'request_id must be a valid request id');
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Peek at the commitment so the request row can be locked BEFORE the
    // donor row (same order as acceptRequest). Re-verified after both locks.
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
    if (!donorProfile || !donorProfile.blood_group) {
      throw httpError(400, 'Set your blood group first before logging a donation');
    }

    const committedRequestId = donorProfile.committed_request_id || null;
    if (committedRequestId !== peekedRequestId) {
      throw httpError(409, 'Your commitment changed while saving — please refresh and try again');
    }
    if (claimedRequestId !== null && claimedRequestId !== committedRequestId) {
      throw httpError(409, 'A donation can only be recorded for the request you have accepted');
    }

    // --- request-linked donation: must be the donor's live, accepted request
    if (committedRequestId) {
      if (!request) {
        throw httpError(409, 'The request you committed to no longer exists');
      }
      if (request.status !== 'donor_accepted') {
        throw httpError(409, `This request is ${request.status}, so a donation cannot be recorded against it`);
      }
      if (!DONATION_LOGGABLE_STATES.includes(donorProfile.current_status)) {
        throw httpError(409, 'Your commitment is not in a state where a donation can be recorded');
      }
      const [accepted] = await conn.query(
        `SELECT 1 FROM request_responses WHERE request_id = ? AND donor_id = ? AND status = 'accepted'`,
        [committedRequestId, donorId]
      );
      if (accepted.length === 0) {
        throw httpError(409, 'You have not accepted this request');
      }
      if (!canDonorGiveToRecipient(donorProfile.blood_group, request.blood_group)) {
        throw httpError(409, 'Your blood group is not compatible with this request');
      }
      const [dupes] = await conn.query(
        'SELECT id FROM donations WHERE donor_id = ? AND request_id = ? LIMIT 1',
        [donorId, committedRequestId]
      );
      if (dupes.length > 0) {
        throw httpError(409, 'A donation has already been recorded for this request');
      }
      // A donation for a request cannot predate accepting it. One day of
      // slack covers donors whose local date is ahead of UTC.
      const startedAt = donorProfile.commitment_started_at || request.created_at;
      if (startedAt) {
        const startDate = new Date(startedAt).toISOString().slice(0, 10);
        if (daysBetween(startDate, donation_date) < -1) {
          throw httpError(400, 'donation_date cannot be earlier than when you accepted this request');
        }
      }
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
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [
        donorId,
        committedRequestId,
        donation_date,
        hospital_name.trim(),
        unitCount,
        donorProfile.blood_group,
        recipient_case && recipient_case.trim() ? recipient_case.trim() : null,
      ]
    );

    if (committedRequestId) {
      const [fulfil] = await conn.query(
        `UPDATE requests SET status = 'fulfilled' WHERE id = ? AND status = 'donor_accepted'`,
        [committedRequestId]
      );
      if (fulfil.affectedRows === 0) {
        throw httpError(409, 'Request was updated by someone else — please refresh and try again');
      }
    }

    // A plain history entry that is older than the donation already on file
    // changes nothing about the donor's current state or cooldown.
    if (!committedRequestId && !isNewest) {
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
             committed_request_id = NULL,
             commitment_ended_at = NOW(),
             status_changed_at = NOW()
       WHERE user_id = ?`,
      [
        effectiveLast,
        cooldownInfo.cooldownUntil,
        nextStatus,
        nextIsAvailable,
        donorId,
      ]
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
