import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequestPayload, MANUAL_REQUEST_STATUSES } from '../utils/validation.js';
import { closeRequestByRequester } from '../services/requestLifecycle.js';
import { getCompatibleDonorGroups } from '../services/matching/compatibility.js';
import { rankDonorCandidates } from '../services/matching/donorMatching.js';
import { acceptRequest, declineRequest } from '../services/donorCommitment.js';

const router = Router();

// Every route in this file requires a logged-in user of SOME role
router.use(authenticate);

// POST /api/requests — create a new blood request. Requester only.
// Enforces 24-hour rate limit (max 3 requests/day) as mandated by prototype abuse prevention policy.
router.post('/', authorize('requester'), async (req, res, next) => {
  try {
    const errors = validateRequestPayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

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
      prescription_slip,
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO requests
         (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by,
          patient_case, contact_phone, attendant_name, prescription_slip, status, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', FALSE)`,
      [
        req.user.id,
        blood_group,
        units_needed,
        hospital_name.trim(),
        city.trim(),
        urgency,
        required_by ? new Date(required_by) : null,
        patient_case ? patient_case.trim() : null,
        contact_phone ? contact_phone.trim() : null,
        attendant_name ? attendant_name.trim() : null,
        prescription_slip ? prescription_slip.trim() : null,
      ]
    );

    res.status(201).json({ id: result.insertId, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// GET /api/requests/mine — a requester only ever sees their own requests
router.get('/mine', authorize('requester'), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, blood_group, units_needed, hospital_name, city, urgency,
              required_by, status, is_verified, created_at,
              patient_case, contact_phone, attendant_name, prescription_slip
       FROM requests
       WHERE requester_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    // Compute matched donor counts for active requests
    const enriched = await Promise.all(
      rows.map(async (r) => {
        try {
          const compatibleGroups = getCompatibleDonorGroups(r.blood_group);
          const [donors] = await pool.query(
            `SELECT COUNT(*) AS total
             FROM donor_profiles
             WHERE is_available = TRUE AND blood_group IN (?)`,
            [compatibleGroups]
          );
          return { ...r, matched_donors_count: donors[0]?.total || 0 };
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
    const [rows] = await pool.query(
      `SELECT id, blood_group, units_needed, hospital_name, city, urgency,
              required_by, status, is_verified, created_at,
              patient_case, contact_phone, attendant_name, prescription_slip
       FROM requests
       WHERE requester_id = ?
         AND status IN ('fulfilled', 'cancelled', 'expired')
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    const fulfilled = rows.filter((r) => r.status === 'fulfilled');
    const totalUnits = fulfilled.reduce((acc, r) => acc + (Number(r.units_needed) || 0), 0);
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
              dp.blood_group, dp.last_donation_date, dp.is_blood_group_verified,
              COALESCE(dp.phone_masked, TRUE) AS phone_masked,
              dp.current_status, dp.committed_request_id
       FROM donor_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_available = TRUE AND dp.blood_group IN (?)`,
      [compatibleGroups]
    );

    const ranked = rankDonorCandidates(candidates, request);

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
router.post('/:id/alert/:donorId', authorize('requester'), async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const donorId = Number(req.params.donorId);
    if (!Number.isInteger(requestId) || !Number.isInteger(donorId)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    const [reqRows] = await pool.query(
      'SELECT id, hospital_name, blood_group FROM requests WHERE id = ? AND requester_id = ?',
      [requestId, req.user.id]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    await pool.query(
      `INSERT INTO request_responses (request_id, donor_id, status, responded_at)
       VALUES (?, ?, 'notified', NOW())
       ON DUPLICATE KEY UPDATE status = IF(status = 'accepted', status, 'notified'), responded_at = NOW()`,
      [requestId, donorId]
    );

    res.json({
      status: 'ok',
      message: `Emergency alert dispatched to donor for ${reqRows[0].blood_group} blood at ${reqRows[0].hospital_name}.`,
    });
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

    const result = await acceptRequest(req.user.id, requestId);
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
