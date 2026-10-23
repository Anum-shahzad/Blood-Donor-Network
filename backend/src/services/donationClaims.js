// Donation claims: the donor CLAIMS a donation, the requester CONFIRMS it.
//
//   Committed -> En Route -> Arrived -> Donation Claimed -> confirmed | disputed
//
// A claim (request_responses.status = 'claimed') proves nothing by itself. Until
// the requester answers it:
//   - nothing is written to `donations`,
//   - the request is not fulfilled and no unit counts as donated / sourced,
//   - the donor's last_donation_date and cooldown are untouched,
//   - the claimed units stay held (see requestUnits.js), so they cannot be
//     promised to another donor and then double counted.
//
// Only the requester who owns the request can confirm or dispute, and the
// answer is final for that claim: confirm / dispute both require the response to
// still be 'claimed', so a repeat, a double click or a retry is refused (409)
// and can never add a second donation record or count units twice.
//
// Lock order matches acceptRequest / recordDonation: request row, then donor row,
// then the response row.
import { pool } from '../config/db.js';
import { canDonorClaimDonation, computeCooldownInfo } from './matching/donorState.js';
import { canDonorGiveToRecipient } from './matching/compatibility.js';
import { loadUnitProgress, settleRequestStatus } from './requestUnits.js';
import { donorOutcomeAfterRelease } from './requestClosureRules.js';
import { validateDonationDate, daysBetween, DONATION_COOLDOWN_DAYS } from '../utils/validation.js';
import { assertDonorMeetsDonationLevel } from './verification/verificationService.js';
import { createRequesterNotification, NOTIFICATION_TYPE_DONATION_CLAIM } from './notifications/notificationService.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const MAX_UNITS_PER_DONATION = 2;

// Donor says "I donated". Creates a PENDING claim only.
export async function claimDonation(donorId, { donation_date, hospital_name, recipient_case, units = 1, request_id = null }) {
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

    const [donorRows] = await conn.query('SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE', [donorId]);
    const donorProfile = donorRows[0];
    if (!donorProfile || !donorProfile.blood_group) {
      throw httpError(400, 'Set your blood group first');
    }
    const committedRequestId = donorProfile.committed_request_id || null;
    if (committedRequestId !== peekedRequestId) {
      throw httpError(409, 'Your commitment changed while saving — please refresh and try again');
    }
    if (claimedRequestId !== null && claimedRequestId !== committedRequestId) {
      throw httpError(409, 'A donation can only be claimed for the request you have accepted');
    }

    await assertDonorMeetsDonationLevel(donorId, conn);

    // Enforced on the server: no claim from COMMITTED or EN_ROUTE.
    const stateCheck = canDonorClaimDonation(donorProfile);
    if (!stateCheck.ok) throw httpError(409, stateCheck.reason);

    if (!request) throw httpError(409, 'The request you committed to no longer exists');
    if (request.status !== 'donor_accepted') {
      throw httpError(409, `This request is ${request.status}, so a donation cannot be claimed against it`);
    }

    const [responseRows] = await conn.query(
      `SELECT status, committed_units FROM request_responses
        WHERE request_id = ? AND donor_id = ? FOR UPDATE`,
      [committedRequestId, donorId]
    );
    const response = responseRows[0];
    if (!response) throw httpError(409, 'You have not accepted this request');
    if (response.status === 'claimed') {
      throw httpError(409, 'You have already claimed this donation — it is waiting for the requester to confirm');
    }
    if (response.status !== 'accepted') {
      throw httpError(409, 'You do not have an active commitment on this request');
    }
    const promisedUnits = Number(response.committed_units) || 1;
    if (unitCount > promisedUnits) {
      throw httpError(409, `You committed ${promisedUnits} unit${promisedUnits === 1 ? '' : 's'} for this request`);
    }
    const progress = await loadUnitProgress(conn, committedRequestId, request.units_needed);
    if (progress.donated + unitCount > progress.required) {
      throw httpError(409, 'This donation would exceed the units this request needs');
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

    const startedAt = donorProfile.commitment_started_at || request.created_at;
    if (startedAt) {
      const startDate = new Date(startedAt).toISOString().slice(0, 10);
      if (daysBetween(startDate, donation_date) < -1) {
        throw httpError(400, 'donation_date cannot be earlier than when you accepted this request');
      }
    }

    // Same spacing rule as before: no two donations within the cooldown.
    const [priorRows] = await conn.query('SELECT donation_date FROM donations WHERE donor_id = ?', [donorId]);
    const knownDates = priorRows.map((r) => String(r.donation_date).slice(0, 10));
    if (donorProfile.last_donation_date) knownDates.push(String(donorProfile.last_donation_date).slice(0, 10));
    for (const known of knownDates) {
      if (Math.abs(daysBetween(known, donation_date)) < DONATION_COOLDOWN_DAYS) {
        throw httpError(
          409,
          `This date is within ${DONATION_COOLDOWN_DAYS} days of your donation on ${known}. Donations must be at least ${DONATION_COOLDOWN_DAYS} days apart.`
        );
      }
    }

    const [claimed] = await conn.query(
      `UPDATE request_responses
          SET status = 'claimed', claimed_at = NOW(), claim_resolved_at = NULL,
              claim_donation_date = ?, claim_hospital_name = ?, claim_recipient_case = ?, claim_units = ?,
              responded_at = NOW()
        WHERE request_id = ? AND donor_id = ? AND status = 'accepted'`,
      [
        donation_date,
        hospital_name.trim(),
        recipient_case && recipient_case.trim() ? recipient_case.trim() : null,
        unitCount,
        committedRequestId,
        donorId,
      ]
    );
    if (claimed.affectedRows !== 1) {
      throw httpError(409, 'Your commitment changed while saving — please refresh and try again');
    }

    // Donation Claimed. The donor stays attached to the request (and out of
    // matching) until the requester answers; no cooldown starts here.
    await conn.query(
      `UPDATE donor_profiles
          SET current_status = 'DONATION_COMPLETED', status_changed_at = NOW()
        WHERE user_id = ? AND committed_request_id = ?`,
      [donorId, committedRequestId]
    );

    const notification = await createRequesterNotification(conn, {
      requesterId: request.requester_id,
      requestId: committedRequestId,
      donorId,
      type: NOTIFICATION_TYPE_DONATION_CLAIM,
      state: 'CLAIMED',
      commitmentStartedAt: donorProfile.commitment_started_at,
    });

    await conn.commit();
    return {
      request_id: committedRequestId,
      donor_status: 'DONATION_COMPLETED',
      claim_status: 'pending_confirmation',
      units_claimed: unitCount,
      requester_notified: notification.created,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Shared by confirm and dispute: lock request (owner only), donor, response.
async function lockClaim(conn, { requestId, donorId, requesterId }) {
  const [requestRows] = await conn.query(
    'SELECT * FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE',
    [requestId, requesterId]
  );
  const request = requestRows[0];
  if (!request) throw httpError(404, 'Request not found'); // also the answer for someone else's request

  const [donorRows] = await conn.query('SELECT * FROM donor_profiles WHERE user_id = ? FOR UPDATE', [donorId]);
  const donorProfile = donorRows[0] || null;

  const [responseRows] = await conn.query(
    'SELECT * FROM request_responses WHERE request_id = ? AND donor_id = ? FOR UPDATE',
    [requestId, donorId]
  );
  const response = responseRows[0];
  if (!response) throw httpError(404, 'No donation claim found for this donor');
  if (response.status === 'donated') throw httpError(409, 'This donation has already been confirmed');
  if (response.status === 'disputed') throw httpError(409, 'This claim was already marked as not having happened');
  if (response.status !== 'claimed') throw httpError(409, 'This donor has no pending donation claim');
  return { request, donorProfile, response };
}

// Requester: "Confirm Received". Only now does the donation count.
export async function confirmDonationClaim({ requestId, donorId, requesterId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { request, donorProfile, response } = await lockClaim(conn, { requestId, donorId, requesterId });

    if (request.status !== 'donor_accepted') {
      throw httpError(409, `This request is ${request.status}, so the claim can no longer be confirmed`);
    }
    if (!donorProfile || !donorProfile.blood_group) {
      throw httpError(409, 'Donor profile not found');
    }

    const claimUnits = Number(response.claim_units) || Number(response.committed_units) || 1;
    const progress = await loadUnitProgress(conn, requestId, request.units_needed);
    if (progress.donated + claimUnits > progress.required) {
      throw httpError(409, 'Confirming this would exceed the units this request needs');
    }
    const [dupes] = await conn.query(
      'SELECT id FROM donations WHERE donor_id = ? AND request_id = ? LIMIT 1',
      [donorId, requestId]
    );
    if (dupes.length > 0) {
      throw httpError(409, 'A donation has already been recorded for this request');
    }

    const donationDate = String(response.claim_donation_date).slice(0, 10);
    // The requester has confirmed it, so the record is marked verified.
    const [donationInsert] = await conn.query(
      `INSERT INTO donations (donor_id, request_id, donation_date, hospital_name, units, blood_group, recipient_case, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        donorId,
        requestId,
        donationDate,
        response.claim_hospital_name || request.hospital_name,
        claimUnits,
        donorProfile.blood_group,
        response.claim_recipient_case || null,
      ]
    );

    const [confirmed] = await conn.query(
      `UPDATE request_responses
          SET status = 'donated', confirmed_units = ?, claim_resolved_at = NOW(), responded_at = NOW()
        WHERE request_id = ? AND donor_id = ? AND status = 'claimed'`,
      [claimUnits, requestId, donorId]
    );
    if (confirmed.affectedRows !== 1) {
      throw httpError(409, 'This claim was updated by someone else — please refresh and try again');
    }

    // Fulfilled only when confirmed units reach units_needed; otherwise the
    // request stays open for the units still outstanding.
    const settled = await settleRequestStatus(conn, request);

    // Cooldown starts now, from the donation date. last_donation_date only
    // ever moves forward, so this can never shorten an existing cooldown.
    const profileLast = donorProfile.last_donation_date ? String(donorProfile.last_donation_date).slice(0, 10) : null;
    const effectiveLast = !profileLast || donationDate > profileLast ? donationDate : profileLast;
    const cooldownInfo = computeCooldownInfo(effectiveLast, DONATION_COOLDOWN_DAYS);
    const stillOnThisRequest = Number(donorProfile.committed_request_id) === Number(requestId);

    if (stillOnThisRequest) {
      await conn.query(
        `UPDATE donor_profiles
            SET last_donation_date = ?, cooldown_until = ?, current_status = ?,
                is_available = CASE WHEN ? THEN is_available ELSE FALSE END,
                committed_request_id = NULL, commitment_ended_at = NOW(), status_changed_at = NOW()
          WHERE user_id = ? AND committed_request_id = ?`,
        [effectiveLast, cooldownInfo.cooldownUntil, cooldownInfo.isEligible ? 'AVAILABLE' : 'COOLDOWN', cooldownInfo.isEligible, donorId, requestId]
      );
    } else {
      await conn.query(
        'UPDATE donor_profiles SET last_donation_date = ?, cooldown_until = ? WHERE user_id = ?',
        [effectiveLast, cooldownInfo.cooldownUntil, donorId]
      );
    }

    await conn.commit();
    return {
      request_id: requestId,
      donor_id: donorId,
      donation_id: donationInsert.insertId,
      claim_status: 'confirmed',
      request_status: settled.status,
      units_required: settled.progress.required,
      units_donated: settled.progress.donated,
      units_committed: settled.progress.committed,
      units_remaining: settled.progress.remaining,
      units_open: settled.progress.open,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Requester: "Did Not Happen". The claim is kept (status 'disputed', with every
// claim detail) so it can be reported and investigated, but it is NOT counted:
// no donation record, no units, no cooldown. The donor is released like any other
// unsuccessful donation, and the units open up for other donors.
export async function disputeDonationClaim({ requestId, donorId, requesterId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { request, donorProfile } = await lockClaim(conn, { requestId, donorId, requesterId });

    const [disputed] = await conn.query(
      `UPDATE request_responses
          SET status = 'disputed', claim_resolved_at = NOW(), confirmed_units = 0, responded_at = NOW()
        WHERE request_id = ? AND donor_id = ? AND status = 'claimed'`,
      [requestId, donorId]
    );
    if (disputed.affectedRows !== 1) {
      throw httpError(409, 'This claim was updated by someone else — please refresh and try again');
    }

    if (donorProfile && Number(donorProfile.committed_request_id) === Number(requestId)) {
      const outcome = donorOutcomeAfterRelease(donorProfile.last_donation_date);
      await conn.query(
        `UPDATE donor_profiles
            SET current_status = ?,
                is_available = CASE WHEN ? THEN is_available ELSE FALSE END,
                cooldown_until = COALESCE(?, cooldown_until),
                committed_request_id = NULL, commitment_ended_at = NOW(), status_changed_at = NOW()
          WHERE user_id = ? AND committed_request_id = ?`,
        [outcome.current_status, outcome.keepIsAvailable, outcome.cooldown_until, donorId, requestId]
      );
    }

    const settled = await settleRequestStatus(conn, request);

    await conn.commit();
    return {
      request_id: requestId,
      donor_id: donorId,
      claim_status: 'disputed',
      request_status: settled.status,
      units_required: settled.progress.required,
      units_donated: settled.progress.donated,
      units_committed: settled.progress.committed,
      units_remaining: settled.progress.remaining,
      units_open: settled.progress.open,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
