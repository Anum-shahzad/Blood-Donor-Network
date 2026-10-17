// Database-backed logic for optional request evidence: requester submissions,
// private document access, and admin review.
//
// Hard rules enforced here (never in the client):
//   * Evidence is optional. Nothing in this file creates, blocks, verifies,
//     cancels or expires a request, and nothing reads or writes
//     requests.is_verified / requests.status. Request verification and donor
//     acceptance (acceptRequest) are untouched.
//   * Every file goes through Phase 1's prepareFiles(): identified by its
//     content signature (not extension or client MIME), capped at 5 MB, stored
//     under a random server-generated name.
//   * A document is only ever returned to the request's owner or to an admin.
//   * Requesters never receive internal admin notes or reviewer identity.
//   * Every state change runs in one transaction that locks the request row
//     first (the same row, and the same first lock, that acceptRequest and the
//     request-closing routine take), then the submission row.
import { pool } from '../../config/db.js';
import { prepareFiles } from '../verification/verificationService.js';
import { MAX_FILE_BYTES, validateReason } from '../verification/verificationRules.js';
import {
  EVIDENCE_STATUSES,
  REVIEW_DECISIONS,
  MAX_EVIDENCE_FILES,
  MAX_EVIDENCE_SUBMISSIONS_PER_DAY,
  MAX_EVIDENCE_SUBMISSIONS_PER_REQUEST,
  EVIDENCE_NOTICE,
  evaluateEvidenceSubmission,
  canRequesterSubmit,
  decideReview,
  requesterFeedback,
  validateOptionalText,
  normalizeOptionalText,
} from './requestEvidenceRules.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// 48 hex characters + extension, as generated for every stored file.
const STORAGE_KEY_PATTERN = /^[a-f0-9]{48}\.(jpg|png|webp|pdf)$/;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function evidenceLimits() {
  return {
    max_file_bytes: MAX_FILE_BYTES,
    max_files: MAX_EVIDENCE_FILES,
    allowed_types: ALLOWED_MIME_TYPES,
  };
}

// Metadata only: the blob column is never selected here.
async function loadFilesBySubmission(submissionIds, exec = pool) {
  const map = new Map();
  if (submissionIds.length === 0) return map;
  const [rows] = await exec.query(
    `SELECT submission_id, storage_key, content_type, size_bytes, created_at
       FROM request_evidence_files
      WHERE submission_id IN (?)
      ORDER BY id ASC`,
    [submissionIds]
  );
  for (const r of rows) {
    if (!map.has(r.submission_id)) map.set(r.submission_id, []);
    map.get(r.submission_id).push({
      key: r.storage_key,
      content_type: r.content_type,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Requester: submit evidence
// ---------------------------------------------------------------------------

export async function submitRequestEvidence(requesterId, requestId, files, meta = {}) {
  const noteError = validateOptionalText(meta.note, 'note');
  if (noteError) throw httpError(400, noteError);
  const note = normalizeOptionalText(meta.note);

  // Signature / size / empty-file checks, before any database work.
  const prepared = prepareFiles(files, MAX_EVIDENCE_FILES);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the request row first. Ownership is part of the lookup, so another
    // requester's request is the same 404 as one that does not exist.
    const [requestRows] = await conn.query(
      'SELECT id, status FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE',
      [requestId, requesterId]
    );
    const request = requestRows[0];
    if (!request) throw httpError(404, 'Request not found');

    const [latestRows] = await conn.query(
      'SELECT id, status FROM request_evidence_submissions WHERE request_id = ? ORDER BY id DESC LIMIT 1',
      [requestId]
    );
    const verdict = evaluateEvidenceSubmission({
      latestStatus: latestRows[0]?.status ?? null,
      requestStatus: request.status,
    });
    if (!verdict.ok) throw httpError(verdict.httpStatus, verdict.reason);

    const [[perRequest]] = await conn.query(
      'SELECT COUNT(*) AS n FROM request_evidence_submissions WHERE request_id = ?',
      [requestId]
    );
    if (Number(perRequest.n) >= MAX_EVIDENCE_SUBMISSIONS_PER_REQUEST) {
      throw httpError(429, 'This request has reached the maximum number of evidence submissions.');
    }

    const [[recent]] = await conn.query(
      `SELECT COUNT(*) AS n
         FROM request_evidence_submissions s
         JOIN requests r ON r.id = s.request_id
        WHERE r.requester_id = ? AND s.submitted_at >= NOW() - INTERVAL 1 DAY`,
      [requesterId]
    );
    if (Number(recent.n) >= MAX_EVIDENCE_SUBMISSIONS_PER_DAY) {
      throw httpError(429, 'Too many evidence uploads today. Please try again tomorrow.');
    }

    const [result] = await conn.query(
      `INSERT INTO request_evidence_submissions (request_id, status, requester_note)
       VALUES (?, 'pending', ?)`,
      [requestId, note]
    );
    const submissionId = result.insertId;

    for (const f of prepared) {
      await conn.query(
        `INSERT INTO request_evidence_files
           (submission_id, storage_key, content_type, size_bytes, sha256, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [submissionId, f.storageKey, f.mime, f.buffer.length, f.sha256, f.buffer]
      );
    }

    await conn.commit();
    return { id: submissionId, request_id: requestId, status: 'pending' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Requester: current status and admin feedback
// ---------------------------------------------------------------------------

// One entry per request that has evidence (its latest submission). Contains
// only what the requester may see: status, their own note and files, the
// admin's message for rejected / more_info, and timestamps. No internal notes,
// no reviewer identity.
export async function getMyEvidenceSummaries(requesterId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.request_id, s.status, s.requester_note, s.submitted_at,
            s.reviewed_at, s.decision_reason, r.status AS request_status
       FROM request_evidence_submissions s
       JOIN requests r ON r.id = s.request_id
       JOIN (
         SELECT request_id, MAX(id) AS max_id
           FROM request_evidence_submissions
          GROUP BY request_id
       ) m ON m.max_id = s.id
      WHERE r.requester_id = ?
      ORDER BY s.request_id DESC`,
    [requesterId]
  );
  const files = await loadFilesBySubmission(rows.map((r) => r.id));

  return {
    evidence: rows.map((r) => ({
      request_id: r.request_id,
      status: r.status,
      note: r.requester_note || null,
      submitted_at: r.submitted_at,
      reviewed_at: r.reviewed_at || null,
      feedback: requesterFeedback(r.status, r.decision_reason),
      can_submit: canRequesterSubmit({ latestStatus: r.status, requestStatus: r.request_status }),
      files: files.get(r.id) || [],
    })),
    limits: evidenceLimits(),
    notice: EVIDENCE_NOTICE,
  };
}

// ---------------------------------------------------------------------------
// Private document access
// ---------------------------------------------------------------------------

// Returns { content_type, size_bytes, data } if the viewer may see this file,
// otherwise throws the SAME 404 whether the file doesn't exist or belongs to
// someone else, so file names can't be probed. viewer = req.user (role comes
// from the database, see middleware/auth.js).
export async function getEvidenceDocumentForViewer(storageKey, viewer) {
  if (typeof storageKey !== 'string' || !STORAGE_KEY_PATTERN.test(storageKey)) {
    throw httpError(404, 'Document not found');
  }
  const [rows] = await pool.query(
    `SELECT f.content_type, f.size_bytes, f.data, r.requester_id
       FROM request_evidence_files f
       JOIN request_evidence_submissions s ON s.id = f.submission_id
       JOIN requests r ON r.id = s.request_id
      WHERE f.storage_key = ?`,
    [storageKey]
  );
  const row = rows[0];
  const isOwner = row && viewer.role === 'requester' && row.requester_id === viewer.id;
  if (!row || (viewer.role !== 'admin' && !isOwner)) {
    throw httpError(404, 'Document not found');
  }
  return { content_type: row.content_type, size_bytes: row.size_bytes, data: row.data };
}

// ---------------------------------------------------------------------------
// Admin: listing and decisions
// ---------------------------------------------------------------------------

// Latest submission for every request that has one, with its files, the
// requester's note, the current decision (including internal note and the
// reviewer's name) and the decision trail. The page merges this into the
// request list by request_id.
export async function listEvidenceForAdmin() {
  const [rows] = await pool.query(
    `SELECT s.id, s.request_id, s.status, s.requester_note, s.submitted_at,
            s.reviewed_at, s.decision_reason, s.internal_note,
            u.name AS reviewer_name,
            (SELECT COUNT(*) FROM request_evidence_submissions c
              WHERE c.request_id = s.request_id) AS submission_count
       FROM request_evidence_submissions s
       JOIN (
         SELECT request_id, MAX(id) AS max_id
           FROM request_evidence_submissions
          GROUP BY request_id
       ) m ON m.max_id = s.id
       LEFT JOIN users u ON u.id = s.reviewed_by
      ORDER BY s.submitted_at DESC, s.id DESC
      LIMIT 500`
  );

  const files = await loadFilesBySubmission(rows.map((r) => r.id));

  // Decision trail across every submission of these requests, newest first,
  // capped per request.
  const history = new Map();
  if (rows.length > 0) {
    const [reviewRows] = await pool.query(
      `SELECT rv.id, rv.submission_id, s.request_id, rv.decision, rv.reason,
              rv.internal_note, rv.created_at, a.name AS admin_name
         FROM request_evidence_reviews rv
         JOIN request_evidence_submissions s ON s.id = rv.submission_id
         LEFT JOIN users a ON a.id = rv.admin_id
        WHERE s.request_id IN (?)
        ORDER BY rv.id DESC`,
      [rows.map((r) => r.request_id)]
    );
    for (const rv of reviewRows) {
      if (!history.has(rv.request_id)) history.set(rv.request_id, []);
      const list = history.get(rv.request_id);
      if (list.length < 10) {
        list.push({
          id: rv.id,
          submission_id: rv.submission_id,
          decision: rv.decision,
          reason: rv.reason || null,
          internal_note: rv.internal_note || null,
          admin_name: rv.admin_name || null,
          created_at: rv.created_at,
        });
      }
    }
  }

  const counts = Object.fromEntries(EVIDENCE_STATUSES.map((s) => [s, 0]));
  const evidence = rows.map((r) => {
    counts[r.status] += 1;
    return {
      id: r.id,
      request_id: r.request_id,
      status: r.status,
      note: r.requester_note || null,
      submitted_at: r.submitted_at,
      reviewed_at: r.reviewed_at || null,
      decision_reason: r.decision_reason || null,
      internal_note: r.internal_note || null,
      reviewer_name: r.reviewer_name || null,
      submission_count: Number(r.submission_count),
      files: files.get(r.id) || [],
      history: history.get(r.request_id) || [],
    };
  });

  return { evidence, counts };
}

// Records an admin decision on a submission.
//   decision: 'approve' | 'reject' | 'request_info'
//   reject / request_info need a reason (5-500 characters); it is what the
//   requester sees. internal_note is optional and admin-only.
// Decisions are validated here, under the request lock, and every one is
// appended to request_evidence_reviews. A later decision replaces an earlier
// one on the same (latest) submission; an older, superseded submission is
// refused. The request itself is never modified.
export async function reviewEvidence(submissionId, adminId, { decision, reason, internal_note } = {}) {
  if (!Object.hasOwn(REVIEW_DECISIONS, decision)) {
    throw httpError(400, `decision must be one of: ${Object.keys(REVIEW_DECISIONS).join(', ')}`);
  }
  const newStatus = REVIEW_DECISIONS[decision];

  let storedReason = null;
  if (newStatus !== 'approved') {
    const reasonError = validateReason(reason);
    if (reasonError) throw httpError(400, reasonError);
    storedReason = reason.trim();
  }
  const internalError = validateOptionalText(internal_note, 'internal_note');
  if (internalError) throw httpError(400, internalError);
  const internalNote = normalizeOptionalText(internal_note);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Same lock order as submitting: request row, then submission row.
    const [peek] = await conn.query(
      'SELECT request_id FROM request_evidence_submissions WHERE id = ?',
      [submissionId]
    );
    if (!peek[0]) throw httpError(404, 'Evidence submission not found');
    const requestId = peek[0].request_id;

    const [requestRows] = await conn.query('SELECT status FROM requests WHERE id = ? FOR UPDATE', [
      requestId,
    ]);
    if (!requestRows[0]) throw httpError(404, 'Request not found');

    const [subRows] = await conn.query(
      'SELECT id, status FROM request_evidence_submissions WHERE id = ? FOR UPDATE',
      [submissionId]
    );
    const submission = subRows[0];
    if (!submission) throw httpError(404, 'Evidence submission not found');

    const [[latest]] = await conn.query(
      'SELECT MAX(id) AS max_id FROM request_evidence_submissions WHERE request_id = ?',
      [requestId]
    );

    const verdict = decideReview({
      currentStatus: submission.status,
      decision,
      isLatest: Number(latest.max_id) === Number(submission.id),
      requestStatus: requestRows[0].status,
    });
    if (!verdict.ok) throw httpError(verdict.httpStatus, verdict.reason);

    await conn.query(
      `UPDATE request_evidence_submissions
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(),
              decision_reason = ?, internal_note = ?
        WHERE id = ?`,
      [verdict.newStatus, adminId, storedReason, internalNote, submissionId]
    );
    await conn.query(
      `INSERT INTO request_evidence_reviews (submission_id, admin_id, decision, reason, internal_note)
       VALUES (?, ?, ?, ?, ?)`,
      [submissionId, adminId, verdict.newStatus, storedReason, internalNote]
    );

    await conn.commit();
    return {
      submission_id: Number(submissionId),
      request_id: requestId,
      previous_status: submission.status,
      evidence_status: verdict.newStatus,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
