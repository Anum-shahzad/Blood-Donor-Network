// Request lifecycle rules that touch more than one table.
//
// 1. Expiry: a request stops being open once its needed-by time passes. A
//    request with no needed-by time stays open for REQUEST_DEFAULT_TTL_HOURS
//    (default 48h) after it was created, so stale emergencies never linger.
// 2. Closing: when a requester marks a request fulfilled/cancelled, any donor
//    still committed to it is released, otherwise they would stay locked to a
//    closed request and never be matched again.
import { pool } from '../config/db.js';
import { CLOSED_REQUEST_STATUSES } from '../utils/validation.js';

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

// Requester closes their own request. Runs in one transaction so the request
// and the committed donor can never end up disagreeing.
export async function closeRequestByRequester(requestId, requesterId, newStatus) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT status FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE',
      [requestId, requesterId]
    );
    const existing = rows[0];
    if (!existing) {
      throw httpError(404, 'Request not found');
    }
    if (CLOSED_REQUEST_STATUSES.includes(existing.status)) {
      throw httpError(409, `Request is already ${existing.status} and cannot be changed`);
    }

    await conn.query('UPDATE requests SET status = ? WHERE id = ?', [newStatus, requestId]);

    // Release anyone still committed to this request. We do NOT record a
    // donation here: the requester saying "fulfilled" does not prove this
    // donor gave blood, so last_donation_date is left for the donor to set.
    const [released] = await conn.query(
      `UPDATE donor_profiles
          SET current_status = 'AVAILABLE',
              committed_request_id = NULL,
              commitment_ended_at = NOW(),
              status_changed_at = NOW()
        WHERE committed_request_id = ?
          AND current_status IN ('MATCHED', 'COMMITTED', 'EN_ROUTE', 'ARRIVED')`,
      [requestId]
    );

    await conn.commit();
    return { new_status: newStatus, donors_released: released.affectedRows };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
