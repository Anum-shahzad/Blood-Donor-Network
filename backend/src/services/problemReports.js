// "Report a Problem" on a donation / request. This writes to the EXISTING
// fraud_reports table (the same queue admins already review under Fraud
// Reports), with report_type 'donation_dispute', so there is no second report
// system. Who can report what is decided here on the server:
//
//   requester  -> only about a donor who has a response on the requester's OWN request
//   donor      -> only about a request the donor actually has a response on
//
// The report links the request (target_request_id), the donor
// (related_donor_id), the person being reported (target_user_id: the donor when
// a requester reports, the requester when a donor reports), the reporter
// (reporter_id), a reason and free-text details. Filing a report changes
// nothing about the donation itself: a disputed claim is never counted as
// completed, and a report cannot turn one into a completed donation.
import { pool } from '../config/db.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export const REQUESTER_REPORT_REASONS = {
  donor_claim_not_true: 'The donor claimed a donation that did not happen',
  donor_no_show: 'The donor never arrived',
  donor_misconduct: 'The donor behaved inappropriately or asked for something in return',
  other: 'Something else',
};
export const DONOR_REPORT_REASONS = {
  donation_wrongly_disputed: 'I donated, but the requester says it did not happen',
  requester_unreachable: 'I could not reach the requester or patient',
  request_looks_fake: 'The request looks fake or misleading',
  requester_misconduct: 'The requester behaved inappropriately or asked for something in return',
  other: 'Something else',
};

const MAX_DETAILS_LENGTH = 1500;
const MAX_REPORTS_PER_DAY = 5;
// Response states that show this donor really took part in this request.
const REPORTABLE_RESPONSE_STATES = ['accepted', 'claimed', 'disputed', 'failed', 'donated'];

export async function createProblemReport({ reporterId, reporterRole, requestId, donorId, reason, details }) {
  const reasons = reporterRole === 'requester' ? REQUESTER_REPORT_REASONS : DONOR_REPORT_REASONS;
  if (typeof reason !== 'string' || !Object.hasOwn(reasons, reason)) {
    throw httpError(400, `reason must be one of: ${Object.keys(reasons).join(', ')}`);
  }
  if (details != null && typeof details !== 'string') {
    throw httpError(400, 'details must be text');
  }
  const text = (details || '').trim();
  if (text.length > MAX_DETAILS_LENGTH) {
    throw httpError(400, `details must be ${MAX_DETAILS_LENGTH} characters or fewer`);
  }
  if (reason === 'other' && text.length < 10) {
    throw httpError(400, 'Please describe the problem (at least 10 characters)');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Locking the request row also serialises two simultaneous submissions of
    // the same report, so the duplicate check below cannot be raced.
    const [requestRows] = await conn.query(
      reporterRole === 'requester'
        ? 'SELECT id, requester_id, hospital_name FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE'
        : 'SELECT id, requester_id, hospital_name FROM requests WHERE id = ? FOR UPDATE',
      reporterRole === 'requester' ? [requestId, reporterId] : [requestId]
    );
    const request = requestRows[0];
    if (!request) throw httpError(404, 'Request not found');

    const [responseRows] = await conn.query(
      'SELECT status FROM request_responses WHERE request_id = ? AND donor_id = ?',
      [requestId, donorId]
    );
    const response = responseRows[0];
    if (!response || !REPORTABLE_RESPONSE_STATES.includes(response.status)) {
      // Same answer whether the donor is unknown or unrelated, so ids cannot be probed.
      throw httpError(404, 'No matching donation or commitment found for this report');
    }

    const targetUserId = reporterRole === 'requester' ? donorId : request.requester_id;

    const [[recent]] = await conn.query(
      `SELECT COUNT(*) AS n FROM fraud_reports
        WHERE reporter_id = ? AND report_type = 'donation_dispute' AND created_at >= NOW() - INTERVAL 1 DAY`,
      [reporterId]
    );
    if (Number(recent.n) >= MAX_REPORTS_PER_DAY) {
      throw httpError(429, 'You have filed several reports today. Please wait before filing another.');
    }

    const [open] = await conn.query(
      `SELECT id FROM fraud_reports
        WHERE reporter_id = ? AND target_request_id = ? AND related_donor_id = ?
          AND report_type = 'donation_dispute' AND status IN ('pending', 'investigating')
        LIMIT 1`,
      [reporterId, requestId, donorId]
    );
    if (open.length > 0) {
      throw httpError(409, 'You have already reported this. An administrator will review it.');
    }

    const body = [
      `Reason: ${reasons[reason]}`,
      `Reported by the ${reporterRole}`,
      `Request #${requestId} at ${request.hospital_name} — donor response: ${response.status}`,
      text ? `\n${text}` : '',
    ].join('\n').trim();

    const [inserted] = await conn.query(
      `INSERT INTO fraud_reports
         (reporter_id, target_user_id, target_request_id, related_donor_id, report_type, details, status)
       VALUES (?, ?, ?, ?, 'donation_dispute', ?, 'pending')`,
      [reporterId, targetUserId, requestId, donorId, body]
    );
    await conn.query(
      `INSERT INTO fraud_report_events (report_id, actor_id, action, to_status, note)
       VALUES (?, ?, 'filed', 'pending', ?)`,
      [inserted.insertId, reporterId, reason]
    );

    await conn.commit();
    return { report_id: inserted.insertId, status: 'pending' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
