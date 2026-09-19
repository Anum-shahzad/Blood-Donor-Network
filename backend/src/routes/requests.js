import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequestPayload, MANUAL_REQUEST_STATUSES, CLOSED_REQUEST_STATUSES } from '../utils/validation.js';
import { getCompatibleDonorGroups } from '../services/matching/compatibility.js';
import { rankDonorCandidates } from '../services/matching/donorMatching.js';

const router = Router();

// Every route here requires a logged-in requester — a donor or admin token
// gets a 403.
router.use(authenticate, authorize('requester'));

// POST /api/requests — create a new blood request.
router.post('/', async (req, res, next) => {
  try {
    const errors = validateRequestPayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const {
      blood_group,
      units_needed,
      hospital_name,
      city,
      urgency = 'medium',
      required_by,
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO requests
         (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by, status, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', FALSE)`,
      [
        req.user.id,
        blood_group,
        units_needed,
        hospital_name.trim(),
        city.trim(),
        urgency,
        required_by || null,
      ]
    );

    res.status(201).json({ id: result.insertId, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// GET /api/requests/mine — a requester only ever sees their own requests,
// never anyone else's.
router.get('/mine', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, blood_group, units_needed, hospital_name, city, urgency,
              required_by, status, is_verified, created_at
       FROM requests
       WHERE requester_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/requests/:id/status — a requester closing out their own
// request as fulfilled or cancelled. pending/verified/matched are set by
// the system (verification, matching), never by this endpoint.
router.patch('/:id/status', async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const { status } = req.body;
    if (!MANUAL_REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${MANUAL_REQUEST_STATUSES.join(', ')}` });
    }

    const [rows] = await pool.query(
      'SELECT status FROM requests WHERE id = ? AND requester_id = ?',
      [requestId, req.user.id]
    );
    const existing = rows[0];
    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (CLOSED_REQUEST_STATUSES.includes(existing.status)) {
      return res.status(409).json({ error: `Request is already ${existing.status} and cannot be changed` });
    }

    await pool.query('UPDATE requests SET status = ? WHERE id = ?', [status, requestId]);
    res.json({ status: 'ok', new_status: status });
  } catch (err) {
    next(err);
  }
});

// GET /api/requests/:id/matches — potential donor matches for one of the
// requester's own requests. Never exposes another requester's request, even
// to probe whether it exists (404, not 403, if it's not theirs).
router.get('/:id/matches', async (req, res, next) => {
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
      `SELECT u.id, u.name, u.city, dp.blood_group, dp.last_donation_date, dp.is_blood_group_verified
       FROM donor_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_available = TRUE AND dp.blood_group IN (?)`,
      [compatibleGroups]
    );

    const matches = rankDonorCandidates(candidates, request);

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

export default router;
