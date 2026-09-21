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
  requestStatusAfterAccept,
  requestStatusAfterCommitmentCancelled,
} from './matching/donorState.js';
import { canDonorGiveToRecipient } from './matching/compatibility.js';
import { isEligibleByRecency, DONATION_COOLDOWN_MONTHS } from './matching/donorMatching.js';
import { upsertConversation } from './chatService.js';

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
