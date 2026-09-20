import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { BLOOD_GROUPS } from '../utils/validation.js';
import { getCompatibleDonorGroups } from '../services/matching/compatibility.js';
import { cancelCommitment } from '../services/donorCommitment.js';

const router = Router();

// Every route below requires a logged-in donor — a requester or admin token
// gets a 403, not a peek at donor-only data.
router.use(authenticate, authorize('donor'));

// GET /api/donors/me
router.get('/me', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.city,
              dp.blood_group, dp.last_donation_date, dp.is_available, dp.is_blood_group_verified,
              dp.current_status, dp.committed_request_id, dp.commitment_started_at,
              dp.commitment_ended_at, dp.cooldown_until
       FROM users u
       LEFT JOIN donor_profiles dp ON dp.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Donor account not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/donors/matches — compatible, currently-open emergency requests
// this donor hasn't already responded to. Only meaningful while the donor
// is AVAILABLE; a committed/en-route/etc. donor gets an empty list rather
// than requests they're not allowed to accept anyway.
router.get('/matches', async (req, res, next) => {
  try {
    const [donorRows] = await pool.query(
      'SELECT blood_group, current_status, is_available FROM donor_profiles WHERE user_id = ?',
      [req.user.id]
    );
    const donorProfile = donorRows[0];

    if (!donorProfile || !donorProfile.blood_group) {
      return res.json({ matches: [], reason: 'Set your blood group first' });
    }
    if (donorProfile.current_status !== 'AVAILABLE' || !donorProfile.is_available) {
      return res.json({ matches: [], reason: `You are currently ${donorProfile.current_status.toLowerCase()}` });
    }

    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.required_by, r.status, r.created_at
       FROM requests r
       WHERE r.is_verified = TRUE
         AND r.status IN ('verified', 'matched')
         AND NOT EXISTS (
           SELECT 1 FROM request_responses rr
           WHERE rr.request_id = r.id AND rr.donor_id = ?
         )
       ORDER BY
         FIELD(r.urgency, 'critical', 'high', 'medium', 'low'),
         r.created_at ASC`,
      [req.user.id]
    );

    const matches = rows.filter((r) =>
      getCompatibleDonorGroups(r.blood_group).includes(donorProfile.blood_group)
    );

    res.json({ matches, match_count: matches.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/donors/me/commitment/cancel — back out of an accepted request
// before travelling. See services/donorCommitment.js for the transaction
// and services/matching/donorState.js for why this only works from
// COMMITTED.
router.post('/me/commitment/cancel', async (req, res, next) => {
  try {
    const result = await cancelCommitment(req.user.id);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// PUT /api/donors/me — create or update the donor_profiles row.
router.put('/me', async (req, res, next) => {
  try {
    const { blood_group, last_donation_date } = req.body;

    if (!BLOOD_GROUPS.includes(blood_group)) {
      return res.status(400).json({ error: `blood_group must be one of: ${BLOOD_GROUPS.join(', ')}` });
    }

    await pool.query(
      `INSERT INTO donor_profiles (user_id, blood_group, last_donation_date)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         blood_group = VALUES(blood_group),
         last_donation_date = VALUES(last_donation_date)`,
      [req.user.id, blood_group, last_donation_date || null]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/donors/me/availability — the quick toggle, separate from the
// full profile update so the frontend can flip it with one click.
router.patch('/me/availability', async (req, res, next) => {
  try {
    const { is_available } = req.body;
    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ error: 'is_available must be true or false' });
    }

    const [result] = await pool.query(
      'UPDATE donor_profiles SET is_available = ? WHERE user_id = ?',
      [is_available, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: 'No donor profile yet — set your blood group first with PUT /api/donors/me',
      });
    }

    res.json({ status: 'ok', is_available });
  } catch (err) {
    next(err);
  }
});

export default router;
