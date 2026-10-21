import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequestPayload, MANUAL_REQUEST_STATUSES } from '../utils/validation.js';
import { closeRequestByRequester, defaultTtlHours } from '../services/requestLifecycle.js';
import { getCompatibleDonorGroups } from '../services/matching/compatibility.js';
import { rankDonorCandidates } from '../services/matching/donorMatching.js';
import { acceptRequest, declineRequest, markCommitmentUnsuccessful } from '../services/donorCommitment.js';
import { UNIT_PROGRESS_COLUMNS_SQL, withUnitProgress } from '../services/requestUnits.js';
import { parseIdParam, evaluateAlert } from '../services/alertRules.js';
import { checkRadius, parseCoordinates } from '../services/geo.js';
import { getVerificationSummaries } from '../services/verification/verificationService.js';
import { meetsDonationLevel } from '../services/verification/verificationRules.js';
import { createUrgentAlertNotification, sendPushForNotification } from '../services/notifications/notificationService.js';
import { receiveRequestWithEvidence } from '../middleware/uploadDocuments.js';
import { prepareRequestEvidence, insertEvidenceSubmission } from '../services/requestEvidence/requestEvidenceService.js';
import { EVIDENCE_REQUIRED_MESSAGE } from '../services/requestEvidence/requestEvidenceRules.js';

const router = Router();

// Every route in this file requires a logged-in user of SOME role
router.use(authenticate);

// POST /api/requests — create a new blood request. Requester only.
// multipart/form-data: the request's text fields plus 1-3 evidence files in
// the field "documents" (and an optional text field "note"). Supporting
// evidence is MANDATORY and is validated here on the server: a request with no
// file, an empty file, an oversized file or a file that is not a JPEG, PNG,
// WebP or PDF (judged by content, not name) is refused and nothing is stored.
// The request and its evidence are saved in one transaction, so a request can
// never exist without its evidence submission.
// Enforces 24-hour rate limit (max 3 requests/day) as mandated by prototype abuse prevention policy.
router.post('/', authorize('requester'), receiveRequestWithEvidence, async (req, res, next) => {
  let conn;
  try {
    const body = req.body || {};
    const errors = validateRequestPayload(body);
    if (!Array.isArray(req.files) || req.files.length === 0) {
      errors.push(EVIDENCE_REQUIRED_MESSAGE);
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    // File content checks (signature, size, empty files) before any database work.
    const evidence = prepareRequestEvidence(req.files, { note: body.note });

    // Rate-limiting check: max 3 requests per 24 hours per user
    const [recentRows] = await pool.query(
      `SELECT COUNT(*) AS count_today
       FROM requests
       WHERE requester_id = ?
         AND created_at >= NOW() - INTERVAL 1 DAY`,
      [req.user.id]
    );

    if (recentRows[0]?.count_today >= 3) {
      return res.status(429).json({
        error: 'Emergency rate limit reached: Maximum 3 requests per 24 hours allowed to prevent system abuse.',
      });
    }

    const {
      blood_group,
      units_needed,
      hospital_name,
      city,
      urgency = 'medium',
      required_by,
      patient_case,
      contact_phone,
      attendant_name,
    } = body;

    // Optional exact hospital location (already validated above). Without it
    // the city centre is used for distance matching.
    const coords = parseCoordinates(body.latitude, body.longitude);
    const lat = coords.none ? null : Math.round(coords.latitude * 100000) / 100000;
    const lng = coords.none ? null : Math.round(coords.longitude * 100000) / 100000;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO requests
         (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by,
          patient_case, contact_phone, attendant_name, latitude, longitude, status, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', FALSE)`,
      [
        req.user.id,
        blood_group,
        Number(units_needed),
        hospital_name.trim(),
        city.trim(),
        urgency || 'medium',
        required_by ? new Date(required_by) : null,
        patient_case ? patient_case.trim() : null,
        contact_phone ? contact_phone.trim() : null,
        attendant_name ? attendant_name.trim() : null,
        lat,
        lng,
      ]
    );

    // Same transaction as the request: both are saved or neither is.
    await insertEvidenceSubmission(conn, result.insertId, evidence.prepared, evidence.note);

    await conn.commit();
    res.status(201).json({ id: result.insertId, status: 'pending', evidence_status: 'pending' });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch { /* connection already gone */ }
    }
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/requests/mine — a requester only ever sees their own requests
router.get('/mine', authorize('requester'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.required_by, r.status, r.is_verified, r.created_at,
              r.patient_case, r.contact_phone, r.attendant_name, r.prescription_slip,
              ${UNIT_PROGRESS_COLUMNS_SQL}
       FROM requests r
       WHERE r.requester_id = ?
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    // Each donor's commitment and confirmed units, per request. Names only —
    // no contact details are exposed here.
    const commitmentsByRequest = new Map();
    if (rows.length > 0) {
      const [commitRows] = await pool.query(
        `SELECT rr.request_id, rr.donor_id, rr.status, rr.committed_units, rr.confirmed_units,
                u.name AS donor_name, dp.current_status AS donor_state
           FROM request_responses rr
           JOIN users u ON u.id = rr.donor_id
           LEFT JOIN donor_profiles dp ON dp.user_id = rr.donor_id
          WHERE rr.request_id IN (?) AND rr.status IN ('accepted', 'donated', 'failed')
          ORDER BY rr.responded_at ASC, rr.id ASC`,
        [rows.map((r) => r.id)]
      );
      for (const c of commitRows) {
        const list = commitmentsByRequest.get(c.request_id) || [];
        list.push({
          donor_id: c.donor_id,
          donor_name: c.donor_name,
          status: c.status,
          donor_state: c.status === 'accepted' ? c.donor_state : null,
          committed_units: Number(c.committed_units) || 0,
          confirmed_units: Number(c.confirmed_units) || 0,
        });
        commitmentsByRequest.set(c.request_id, list);
      }
    }

    // Compute matched donor counts for active requests
    const enriched = await Promise.all(
      rows.map(withUnitProgress).map(async (r) => {
        r = { ...r, commitments: commitmentsByRequest.get(r.id) || [] };
        try {
          const compatibleGroups = getCompatibleDonorGroups(r.blood_group);
          const [donors] = await pool.query(
            `SELECT user_id
             FROM donor_profiles
             WHERE is_available = TRUE AND blood_group IN (?)`,
            [compatibleGroups]
          );
          // Only donors who can actually accept (verification Level 3+) count.
          const levels = await getVerificationSummaries(donors.map((d) => d.user_id));
          const matchedCount = donors.filter((d) => meetsDonationLevel(levels.get(Number(d.user_id))?.level)).length;
          return { ...r, matched_donors_count: matchedCount };
        } catch {
          return { ...r, matched_donors_count: 0 };
        }
      })
    );

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// GET /api/requests/archive — history of closed requests (fulfilled, cancelled, expired) with summary stats
router.get('/archive', authorize('requester'), async (req, res, next) => {
  try {
    const [rawRows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.required_by, r.status, r.is_verified, r.created_at,
              r.patient_case, r.contact_phone, r.attendant_name, r.prescription_slip,
              ${UNIT_PROGRESS_COLUMNS_SQL}
       FROM requests r
       WHERE r.requester_id = ?
         AND r.status IN ('fulfilled', 'cancelled', 'expired')
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    const rows = rawRows.map(withUnitProgress);

    const fulfilled = rows.filter((r) => r.status === 'fulfilled');
    // Units actually received = confirmed donated units on every closed request.
    const totalUnits = rows.reduce((acc, r) => acc + (Number(r.units_donated) || 0), 0);
    const fulfillmentRate = rows.length > 0 ? Math.round((fulfilled.length / rows.length) * 100) : 0;

    res.json({
      archive: rows,
      stats: {
        total_closed: rows.length,
        total_fulfilled: fulfilled.length,
        total_units_received: totalUnits,
        fulfillment_rate_percent: fulfillmentRate,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/requests/:id/status — requester closing out their own request as fulfilled or cancelled
router.patch('/:id/status', authorize('requester'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const { status } = req.body;
    if (!MANUAL_REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${MANUAL_REQUEST_STATUSES.join(', ')}` });
    }

    // Also releases any donor still committed to this request.
    const result = await closeRequestByRequester(requestId, req.user.id, status);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// GET /api/requests/:id/matches — potential donor matches for one of the requester's own requests
router.get('/:id/matches', authorize('requester'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const [requestRows] = await pool.query(
      'SELECT * FROM requests WHERE id = ? AND requester_id = ?',
      [requestId, req.user.id]
    );
    const request = requestRows[0];
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const compatibleGroups = getCompatibleDonorGroups(request.blood_group);

    const [candidates] = await pool.query(
      `SELECT u.id, u.name, u.city, u.phone,
              dp.blood_group, dp.last_donation_date,
              dp.alert_radius, dp.latitude AS donor_latitude, dp.longitude AS donor_longitude,
              COALESCE(dp.phone_masked, TRUE) AS phone_masked,
              dp.current_status, dp.committed_request_id
       FROM donor_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_available = TRUE AND u.is_suspended = FALSE AND dp.blood_group IN (?)`,
      [compatibleGroups]
    );

    // Respect each donor's Maximum Alert Radius: don't offer a donor whose
    // chosen radius does not reach this request. (Their saved coordinates are
    // used only for this check and are not part of the response.)
    // A donor already committed to THIS request always stays visible to its requester.
    const inRange = candidates.filter((c) => Number(c.committed_request_id) === Number(requestId) || checkRadius({
      donor: { latitude: c.donor_latitude, longitude: c.donor_longitude, city: c.city },
      request: { latitude: request.latitude, longitude: request.longitude, city: request.city },
      radiusKm: c.alert_radius,
    }).ok);

    const summaries = await getVerificationSummaries(inRange.map((c) => c.id));
    // A donor below Level 3 cannot accept a request, so they are not offered as
    // a match. A donor already committed to THIS request stays visible.
    const withVerification = inRange
      .map((c) => ({ ...c, verification: summaries.get(Number(c.id)) }))
      .filter((c) => Number(c.committed_request_id) === Number(requestId) || meetsDonationLevel(c.verification?.level));
    const ranked = rankDonorCandidates(withVerification, request);

    // Apply privacy masking if donor enabled phone masking and is not committed to this request
    const matches = ranked.map((m) => {
      const isCommittedToThis = Number(m.committed_request_id) === Number(requestId);
      const isMasked = Boolean(m.phone_masked) && !isCommittedToThis;
      let displayPhone = m.phone;
      if (isMasked && displayPhone) {
        displayPhone = displayPhone.length > 7
          ? displayPhone.slice(0, 4) + ' ••• ' + displayPhone.slice(-4)
          : 'Protected (Private)';
      }
      return {
        ...m,
        phone: displayPhone,
        phone_masked: isMasked,
        is_committed_to_this: isCommittedToThis,
      };
    });

    res.json({
      request_id: requestId,
      compatible_blood_groups: compatibleGroups,
      match_count: matches.length,
      matches,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/requests/:id/alert/:donorId — dispatch emergency alert to compatible donor
//
// Server-side rules (all in services/alertRules.js): the request must be the
// caller's own, verified, open and unexpired; the target must be an active,
// available, non-suspended DONOR whose blood group is compatible and who is
// outside the post-donation cooldown; and an alert never overwrites a donor's
// earlier response (declined/accepted) or repeats an existing alert.
//
// Runs in one transaction and locks the request, then the donor profile — the
// same order acceptRequest() uses — so an alert cannot slip in between a donor
// accepting and the request closing.
router.post('/:id/alert/:donorId', authorize('requester'), async (req, res, next) => {
  const requestId = parseIdParam(req.params.id);
  const donorId = parseIdParam(req.params.donorId);
  if (requestId === null || donorId === null) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT id, hospital_name, blood_group, status, is_verified, required_by, created_at
         FROM requests WHERE id = ? AND requester_id = ? FOR UPDATE`,
      [requestId, req.user.id]
    );
    const [profileRows] = await conn.query(
      `SELECT blood_group, is_available, current_status, last_donation_date
         FROM donor_profiles WHERE user_id = ? FOR UPDATE`,
      [donorId]
    );
    const [accountRows] = await conn.query(
      'SELECT id, role, is_suspended FROM users WHERE id = ?',
      [donorId]
    );
    const [responseRows] = await conn.query(
      'SELECT status FROM request_responses WHERE request_id = ? AND donor_id = ? FOR UPDATE',
      [requestId, donorId]
    );

    // Donors below Level 3 cannot accept, so they are never alerted.
    const donorLevels = await getVerificationSummaries([donorId], conn);

    const verdict = evaluateAlert({
      request: reqRows[0],
      donorAccount: accountRows[0],
      donorProfile: profileRows[0],
      donorVerificationLevel: donorLevels.get(Number(donorId))?.level,
      existingResponse: responseRows[0],
      ttlHours: defaultTtlHours(),
    });
    if (!verdict.ok) {
      const err = new Error(verdict.message);
      err.status = verdict.status;
      throw err;
    }

    // Plain INSERT (not an upsert): the checks above guarantee no response row
    // exists, and the unique key makes a concurrent duplicate fail instead of
    // overwriting someone's answer.
    await conn.query(
      `INSERT INTO request_responses (request_id, donor_id, status, responded_at)
       VALUES (?, ?, 'notified', NOW())`,
      [requestId, donorId]
    );

    // Saved in the SAME transaction as the 'notified' response row: either the
    // donor has both or neither. The notification step re-checks the donor's
    // alert radius, remaining units, availability and channel preferences on the
    // server; a donor outside their radius still sees the request in their feed
    // (existing behaviour) but is NOT sent a notification.
    const notification = await createUrgentAlertNotification(conn, { requestId, donorId });

    await conn.commit();

    // Web Push runs after the commit (a push must never announce a rollback).
    // Awaited, because serverless hosts freeze the process once the response is sent.
    let push = null;
    if (notification.created && notification.channels.push) {
      push = await sendPushForNotification(notification.notificationId);
    }

    // Only claim what actually happened. Reasons stay generic on purpose: the
    // requester must not learn a donor's location or notification settings.
    let message;
    if (notification.created) {
      message = `Alert saved for ${reqRows[0].blood_group} blood at ${reqRows[0].hospital_name}. The donor will see it on their dashboard`;
      if (push && push.accepted > 0) {
        message += ` and a push notification was sent to ${push.accepted} of their device${push.accepted === 1 ? '' : 's'}.`;
      } else {
        message += '.';
      }
    } else {
      message = `Alert recorded for ${reqRows[0].blood_group} blood at ${reqRows[0].hospital_name}, but no notification was sent to the donor (outside their alert range or their notification settings). They can still find the request in their feed.`;
    }

    res.json({
      status: 'ok',
      message,
      notification: {
        created: notification.created,
        push_accepted: push ? push.accepted : 0,
        push_failed: push ? push.failed + push.expired : 0,
      },
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch { /* connection already gone */ }
    }
    if (err && err.code === 'ER_DUP_ENTRY') {
      err.status = 409;
      err.message = 'This donor has already been alerted for this request';
    }
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/requests/:id/commitments/:donorId/unsuccessful — requester reports
// that a committed donor's donation did not happen or did not succeed. The
// donor's promised units become available to other donors again.
router.post('/:id/commitments/:donorId/unsuccessful', authorize('requester'), async (req, res, next) => {
  try {
    const requestId = parseIdParam(req.params.id);
    const donorId = parseIdParam(req.params.donorId);
    if (requestId === null || donorId === null) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    const result = await markCommitmentUnsuccessful({ requestId, donorId, requesterId: req.user.id });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

function parseRequestId(req, res) {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId)) {
    res.status(400).json({ error: 'Invalid request id' });
    return null;
  }
  return requestId;
}

// POST /api/requests/:id/accept — donor accepts a compatible, open request
router.post('/:id/accept', authorize('donor'), async (req, res, next) => {
  try {
    const requestId = parseRequestId(req, res);
    if (requestId === null) return;

    // units is optional (default 1, max 2): how many units this donor promises.
    const result = await acceptRequest(req.user.id, requestId, { units: req.body?.units });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/requests/:id/decline — donor declines a compatible request
router.post('/:id/decline', authorize('donor'), async (req, res, next) => {
  try {
    const requestId = parseRequestId(req, res);
    if (requestId === null) return;

    const result = await declineRequest(req.user.id, requestId);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
