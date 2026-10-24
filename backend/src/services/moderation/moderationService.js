// Admin moderation: decisions on reports, private investigation notes,
// temporary / permanent suspensions and the account notices that tell people
// what happened.
//
//   decideReport()           dismiss / warn / suspend in ONE transaction: the user
//                            change, the decision record, the report status, the
//                            audit event and the notifications are saved together
//                            or not at all.
//   suspendUser()/reinstateUser()   shared by the report workflow and the older
//                            PATCH /api/admin/donors/:id/status endpoint, so no
//                            suspension path skips the reason or the record.
//   liftExpiredSuspensions() ends temporary suspensions whose time has passed.
//                            Called at login, on every authenticated request for
//                            that user, and as a throttled global sweep, so the
//                            is_suspended flag every other query reads stays true.
//   getReportCase()          everything an admin needs to review one report.
//   account notices          rows in the EXISTING notifications table
//                            (type 'account_notice'); the user polls them.
//
// PRIVACY: report_admin_notes is only ever read by getReportCase() (admin-only
// routes). Nothing in this file puts a note into a notification, a suspension
// reason or any user-facing response.
import { pool } from '../../config/db.js';

export const ACCOUNT_NOTICE_TYPE = 'account_notice';

const MIN_REASON = 10;
const MAX_REASON = 500;
const MAX_NOTE = 2000;
const MAX_SUSPENSION_DAYS = 365;
const OPEN_REPORT_STATUSES = ['pending', 'investigating'];
const SWEEP_EVERY_MS = 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanText(value, { field, min = 1, max }) {
  if (typeof value !== 'string') throw httpError(400, `${field} is required`);
  const text = value.trim();
  if (text.length < min) {
    throw httpError(400, min > 1 ? `${field} must be at least ${min} characters` : `${field} is required`);
  }
  if (text.length > max) throw httpError(400, `${field} must be ${max} characters or fewer`);
  return text;
}

function fmtUtc(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// What the person is told when they are blocked. Used by login and by the
// authenticate middleware. Only ever sent to someone who proved who they are.
export function describeSuspension(account) {
  const permanent = !account.suspended_until;
  return {
    permanent,
    until: permanent ? null : account.suspended_until,
    reason: account.suspension_reason || null,
  };
}

export function suspensionMessage(account) {
  const s = describeSuspension(account);
  const parts = [s.permanent ? 'Your account has been suspended.' : `Your account has been suspended until ${fmtUtc(s.until)}.`];
  if (s.reason) parts.push(`Reason: ${s.reason}`);
  parts.push('Please contact the administrator.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Account notices (existing notifications table)
// ---------------------------------------------------------------------------
async function createAccountNotice(conn, { userId, dedupeKey, title, body }) {
  await conn.query(
    `INSERT IGNORE INTO notifications
       (user_id, type, request_id, dedupe_key, channel_inapp, channel_browser, channel_push, title, body)
     VALUES (?, ?, NULL, ?, TRUE, FALSE, FALSE, ?, ?)`,
    [userId, ACCOUNT_NOTICE_TYPE, dedupeKey, title, body]
  );
}

export async function getAccountNotices(userId, { limit = 10 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, title, body, created_at
       FROM notifications
      WHERE user_id = ? AND type = ? AND read_at IS NULL
      ORDER BY id DESC
      LIMIT ?`,
    [userId, ACCOUNT_NOTICE_TYPE, Math.min(Math.max(Number(limit) || 10, 1), 25)]
  );
  return rows;
}

export async function markAccountNoticesRead(userId, ids) {
  if (!ids.length) return 0;
  const [r] = await pool.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE user_id = ? AND type = ? AND id IN (?)',
    [userId, ACCOUNT_NOTICE_TYPE, ids]
  );
  return r.affectedRows;
}

// ---------------------------------------------------------------------------
// Suspension primitives (all take the caller's transaction connection)
// ---------------------------------------------------------------------------
// durationDays XOR permanent. Writes the user flag, the decision record and the
// notice to the user. Throws 409 if the account is already suspended.
export async function suspendUser(conn, { userId, adminId, reportId = null, reason, permanent, durationDays }) {
  const cleanReason = cleanText(reason, { field: 'reason', min: MIN_REASON, max: MAX_REASON });
  let days = null;
  if (permanent === true) {
    if (durationDays != null) throw httpError(400, 'Choose either a permanent suspension or a number of days, not both');
  } else {
    days = Number(durationDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_SUSPENSION_DAYS) {
      throw httpError(400, `duration_days must be a whole number from 1 to ${MAX_SUSPENSION_DAYS}, or choose permanent`);
    }
  }

  const [rows] = await conn.query(
    `SELECT id, role, name,
            (is_suspended AND (suspended_until IS NULL OR suspended_until > NOW())) AS suspended_now
       FROM users WHERE id = ? FOR UPDATE`,
    [userId]
  );
  const user = rows[0];
  if (!user) throw httpError(404, 'User not found');
  if (user.role === 'admin') throw httpError(403, 'Administrator accounts cannot be warned or suspended');
  if (user.suspended_now) {
    throw httpError(409, 'This account is already suspended. Reinstate it first if you want to change the suspension.');
  }

  if (days === null) {
    await conn.query(
      `UPDATE users SET is_suspended = TRUE, suspended_until = NULL, suspension_reason = ?,
              suspended_at = NOW(), suspended_by = ? WHERE id = ?`,
      [cleanReason, adminId, userId]
    );
  } else {
    await conn.query(
      `UPDATE users SET is_suspended = TRUE, suspended_until = NOW() + INTERVAL ? DAY, suspension_reason = ?,
              suspended_at = NOW(), suspended_by = ? WHERE id = ?`,
      [days, cleanReason, adminId, userId]
    );
  }
  const [[after]] = await conn.query('SELECT suspended_until FROM users WHERE id = ?', [userId]);

  const [action] = await conn.query(
    `INSERT INTO moderation_actions (report_id, target_user_id, admin_id, action, reason, is_permanent, suspended_until)
     VALUES (?, ?, ?, 'suspension', ?, ?, ?)`,
    [reportId, userId, adminId, cleanReason, days === null, after.suspended_until]
  );

  await createAccountNotice(conn, {
    userId,
    dedupeKey: `moderation:${action.insertId}:user`,
    title: days === null ? 'Your account has been suspended' : 'Your account has been temporarily suspended',
    body: `${days === null ? 'Your account is suspended until further notice.' : `Your account is suspended until ${fmtUtc(after.suspended_until)}.`} Reason: ${cleanReason}`,
  });

  return { actionId: action.insertId, suspendedUntil: after.suspended_until, permanent: days === null };
}

// Clears the suspension and records it. Returns { changed: false } if the
// account was not suspended (nothing is written then).
export async function reinstateUser(conn, { userId, adminId, reason }) {
  const cleanReason = cleanText(reason, { field: 'reason', min: MIN_REASON, max: MAX_REASON });
  const [rows] = await conn.query('SELECT id, role, is_suspended FROM users WHERE id = ? FOR UPDATE', [userId]);
  const user = rows[0];
  if (!user) throw httpError(404, 'User not found');
  if (!user.is_suspended) return { changed: false };

  await conn.query(
    `UPDATE users SET is_suspended = FALSE, suspended_until = NULL, suspension_reason = NULL,
            suspended_at = NULL, suspended_by = NULL WHERE id = ?`,
    [userId]
  );
  const [action] = await conn.query(
    `INSERT INTO moderation_actions (target_user_id, admin_id, action, reason)
     VALUES (?, ?, 'reinstatement', ?)`,
    [userId, adminId, cleanReason]
  );
  await createAccountNotice(conn, {
    userId,
    dedupeKey: `moderation:${action.insertId}:user`,
    title: 'Your account has been reinstated',
    body: `Your suspension has been lifted and you can use the network again. Note from the administrator: ${cleanReason}`,
  });
  return { changed: true, actionId: action.insertId };
}

async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// For the older PATCH /api/admin/donors/:id/status endpoint.
export const suspendUserStandalone = (args) => inTransaction((conn) => suspendUser(conn, args));
export const reinstateUserStandalone = (args) => inTransaction((conn) => reinstateUser(conn, args));

// ---------------------------------------------------------------------------
// Expiry of temporary suspensions
// ---------------------------------------------------------------------------
// Ends every temporary suspension whose time has passed (or just userId's).
// Returns how many were lifted. Re-checks the time under the row lock, so two
// callers racing cannot lift the same suspension twice.
export async function liftExpiredSuspensions(userId = null) {
  return inTransaction(async (conn) => {
    const [due] = await conn.query(
      `SELECT id FROM users
        WHERE is_suspended = TRUE AND suspended_until IS NOT NULL AND suspended_until <= NOW()
          ${userId ? 'AND id = ?' : ''}
        FOR UPDATE`,
      userId ? [userId] : []
    );
    for (const { id } of due) {
      await conn.query(
        `UPDATE users SET is_suspended = FALSE, suspended_until = NULL, suspension_reason = NULL,
                suspended_at = NULL, suspended_by = NULL WHERE id = ?`,
        [id]
      );
      const [action] = await conn.query(
        `INSERT INTO moderation_actions (target_user_id, action, reason)
         VALUES (?, 'suspension_expired', 'Temporary suspension ended')`,
        [id]
      );
      await createAccountNotice(conn, {
        userId: id,
        dedupeKey: `moderation:${action.insertId}:user`,
        title: 'Your suspension has ended',
        body: 'Your temporary suspension is over and you can use the network again.',
      });
    }
    return due.length;
  });
}

let lastSweepAt = 0;
// At most once a minute per server process; never throws (the per-user check
// at login / authenticate still covers the person making the request).
export async function sweepExpiredSuspensions() {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  try {
    await liftExpiredSuspensions();
  } catch (err) {
    console.error('Suspension expiry sweep failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Report case file (admin only)
// ---------------------------------------------------------------------------
export async function getReportCase(reportId) {
  const [reportRows] = await pool.query(
    `SELECT fr.id, fr.report_type, fr.details, fr.status, fr.created_at, fr.reviewed_at, fr.admin_note,
            fr.reporter_id, fr.target_user_id, fr.target_request_id, fr.related_donor_id,
            reporter.name AS reporter_name, reporter.email AS reporter_email, reporter.role AS reporter_role,
            reviewer.name AS reviewed_by_name
       FROM fraud_reports fr
       LEFT JOIN users reporter ON reporter.id = fr.reporter_id
       LEFT JOIN users reviewer ON reviewer.id = fr.reviewed_by
      WHERE fr.id = ?`,
    [reportId]
  );
  const report = reportRows[0];
  if (!report) throw httpError(404, 'Report not found');

  const case_ = { report, target_user: null, request: null, donor_response: null };

  if (report.target_request_id) {
    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency, r.status,
              r.is_verified, r.required_by, r.created_at, r.requester_id, u.name AS requester_name
         FROM requests r JOIN users u ON u.id = r.requester_id WHERE r.id = ?`,
      [report.target_request_id]
    );
    case_.request = rows[0] || null;
  }
  if (report.target_request_id && report.related_donor_id) {
    const [rows] = await pool.query(
      `SELECT rr.status, rr.responded_at, rr.claimed_at, rr.claim_donation_date, rr.claim_hospital_name,
              rr.claim_units, rr.claim_resolved_at, donor.name AS donor_name
         FROM request_responses rr JOIN users donor ON donor.id = rr.donor_id
        WHERE rr.request_id = ? AND rr.donor_id = ?`,
      [report.target_request_id, report.related_donor_id]
    );
    case_.donor_response = rows[0] || null;
  }

  // Reporter track record: helps spot someone filing false reports.
  if (report.reporter_id) {
    const [[stats]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'dismissed'), 0) AS dismissed
         FROM fraud_reports WHERE reporter_id = ?`,
      [report.reporter_id]
    );
    case_.reporter_stats = { total: Number(stats.total), dismissed: Number(stats.dismissed) };
  }

  if (report.target_user_id) {
    const uid = report.target_user_id;
    const [userRows] = await pool.query(
      `SELECT id, name, email, phone, role, city, created_at, is_suspended, suspended_until,
              suspension_reason, suspended_at, suspended_by
         FROM users WHERE id = ?`,
      [uid]
    );
    const user = userRows[0] || null;
    if (user) {
      case_.target_user = {
        ...user,
        // Effective state: a temporary suspension that has run out is not active.
        suspension_active: Boolean(user.is_suspended) && (!user.suspended_until || new Date(user.suspended_until) > new Date()),
      };

      const [otherReports] = await pool.query(
        `SELECT id, report_type, status, created_at, LEFT(details, 300) AS details
           FROM fraud_reports WHERE target_user_id = ? AND id <> ? ORDER BY id DESC LIMIT 10`,
        [uid, reportId]
      );
      const [[otherCount]] = await pool.query(
        'SELECT COUNT(*) AS n FROM fraud_reports WHERE target_user_id = ? AND id <> ?',
        [uid, reportId]
      );
      const [modHistory] = await pool.query(
        `SELECT m.id, m.report_id, m.action, m.reason, m.is_permanent, m.suspended_until, m.created_at,
                a.name AS admin_name
           FROM moderation_actions m LEFT JOIN users a ON a.id = m.admin_id
          WHERE m.target_user_id = ? ORDER BY m.id DESC LIMIT 20`,
        [uid]
      );
      const [[modCounts]] = await pool.query(
        `SELECT COALESCE(SUM(action = 'warning'), 0) AS warnings, COALESCE(SUM(action = 'suspension'), 0) AS suspensions
           FROM moderation_actions WHERE target_user_id = ?`,
        [uid]
      );

      let requestHistory = [];
      let donations_total = null;
      let response_counts = null;
      if (user.role === 'requester') {
        const [rows] = await pool.query(
          `SELECT id, blood_group, units_needed, hospital_name, city, urgency, status, is_verified, created_at
             FROM requests WHERE requester_id = ? ORDER BY id DESC LIMIT 10`,
          [uid]
        );
        requestHistory = rows;
      } else if (user.role === 'donor') {
        const [rows] = await pool.query(
          `SELECT rr.request_id, rr.status, rr.responded_at, rr.claimed_at,
                  r.hospital_name, r.blood_group, r.status AS request_status
             FROM request_responses rr JOIN requests r ON r.id = rr.request_id
            WHERE rr.donor_id = ? ORDER BY rr.request_id DESC LIMIT 10`,
          [uid]
        );
        requestHistory = rows;
        const [[d]] = await pool.query('SELECT COUNT(*) AS n FROM donations WHERE donor_id = ?', [uid]);
        donations_total = Number(d.n);
        const [counts] = await pool.query(
          'SELECT status, COUNT(*) AS n FROM request_responses WHERE donor_id = ? GROUP BY status',
          [uid]
        );
        response_counts = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
      }

      case_.history = {
        other_reports_total: Number(otherCount.n),
        other_reports: otherReports,
        warnings: Number(modCounts.warnings),
        suspensions: Number(modCounts.suspensions),
        moderation: modHistory,
        requests: requestHistory,
        donations_total,
        response_counts,
      };
    }
  }

  // PRIVATE. Admin-only: this function is only reachable through admin routes.
  const [notes] = await pool.query(
    `SELECT n.id, n.note, n.created_at, a.name AS admin_name
       FROM report_admin_notes n LEFT JOIN users a ON a.id = n.admin_id
      WHERE n.report_id = ? ORDER BY n.id ASC`,
    [reportId]
  );
  const [events] = await pool.query(
    `SELECT e.id, e.action, e.from_status, e.to_status, e.note, e.created_at, a.name AS actor_name
       FROM fraud_report_events e LEFT JOIN users a ON a.id = e.actor_id
      WHERE e.report_id = ? ORDER BY e.id ASC`,
    [reportId]
  );
  const [decisions] = await pool.query(
    `SELECT m.id, m.action, m.reason, m.is_permanent, m.suspended_until, m.created_at, a.name AS admin_name
       FROM moderation_actions m LEFT JOIN users a ON a.id = m.admin_id
      WHERE m.report_id = ? ORDER BY m.id ASC`,
    [reportId]
  );

  return { ...case_, notes, events, decisions };
}

export async function addReportNote({ reportId, adminId, note }) {
  const text = cleanText(note, { field: 'note', max: MAX_NOTE });
  return inTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT id FROM fraud_reports WHERE id = ? FOR UPDATE', [reportId]);
    if (rows.length === 0) throw httpError(404, 'Report not found');
    const [r] = await conn.query(
      'INSERT INTO report_admin_notes (report_id, admin_id, note) VALUES (?, ?, ?)',
      [reportId, adminId, text]
    );
    // The audit trail records THAT a note was added, never its content.
    await conn.query(
      `INSERT INTO fraud_report_events (report_id, actor_id, action) VALUES (?, ?, 'note_added')`,
      [reportId, adminId]
    );
    return { id: r.insertId };
  });
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------
export const DECISIONS = ['dismiss', 'warn', 'suspend'];

export async function decideReport({ reportId, adminId, decision, reason, permanent, durationDays }) {
  if (!DECISIONS.includes(decision)) throw httpError(400, `decision must be one of: ${DECISIONS.join(', ')}`);
  const cleanReason = cleanText(reason, { field: 'reason', min: MIN_REASON, max: MAX_REASON });

  return inTransaction(async (conn) => {
    const [reportRows] = await conn.query('SELECT * FROM fraud_reports WHERE id = ? FOR UPDATE', [reportId]);
    const report = reportRows[0];
    if (!report) throw httpError(404, 'Report not found');
    if (!OPEN_REPORT_STATUSES.includes(report.status)) {
      throw httpError(409, `This report is already ${report.status}. A decision can only be made on an open report.`);
    }
    if (decision !== 'dismiss' && !report.target_user_id) {
      throw httpError(400, 'This report is not linked to a user, so there is no one to warn or suspend. Dismiss it or resolve it instead.');
    }

    let actionId;
    let outcome = {};
    if (decision === 'suspend') {
      const s = await suspendUser(conn, {
        userId: report.target_user_id, adminId, reportId, reason: cleanReason, permanent: permanent === true, durationDays,
      });
      actionId = s.actionId;
      outcome = { suspended_until: s.suspendedUntil, permanent: s.permanent };
    } else if (decision === 'warn') {
      const [userRows] = await conn.query('SELECT id, role FROM users WHERE id = ? FOR UPDATE', [report.target_user_id]);
      const user = userRows[0];
      if (!user) throw httpError(404, 'The reported user no longer exists');
      if (user.role === 'admin') throw httpError(403, 'Administrator accounts cannot be warned or suspended');
      const [a] = await conn.query(
        `INSERT INTO moderation_actions (report_id, target_user_id, admin_id, action, reason)
         VALUES (?, ?, ?, 'warning', ?)`,
        [reportId, report.target_user_id, adminId, cleanReason]
      );
      actionId = a.insertId;
      await createAccountNotice(conn, {
        userId: report.target_user_id,
        dedupeKey: `moderation:${actionId}:user`,
        title: 'Warning from the administrator',
        body: `A report about your activity was reviewed. Reason: ${cleanReason} Further violations may lead to suspension.`,
      });
    } else {
      const [a] = await conn.query(
        `INSERT INTO moderation_actions (report_id, target_user_id, admin_id, action, reason)
         VALUES (?, ?, ?, 'dismissal', ?)`,
        [reportId, report.target_user_id, adminId, cleanReason]
      );
      actionId = a.insertId;
    }

    const newStatus = decision === 'dismiss' ? 'dismissed' : 'resolved';
    await conn.query(
      'UPDATE fraud_reports SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [newStatus, adminId, reportId]
    );
    await conn.query(
      `INSERT INTO fraud_report_events (report_id, actor_id, action, from_status, to_status, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reportId, adminId, `decision_${decision}`, report.status, newStatus, cleanReason]
    );

    // The reporter hears the outcome in neutral words. They are never told what
    // happened to the other person, and never shown the admin's reasoning.
    if (report.reporter_id && report.reporter_id !== report.target_user_id) {
      await createAccountNotice(conn, {
        userId: report.reporter_id,
        dedupeKey: `moderation:${actionId}:reporter`,
        title: 'Your report has been reviewed',
        body: decision === 'dismiss'
          ? `We reviewed your report about request #${report.target_request_id ?? 'n/a'} and found no grounds for action at this time. Thank you for reporting.`
          : `We reviewed your report about request #${report.target_request_id ?? 'n/a'} and took appropriate action. For privacy we cannot share details. Thank you for reporting.`,
      });
    }

    return { report_id: reportId, status: newStatus, decision, action_id: actionId, ...outcome };
  });
}
