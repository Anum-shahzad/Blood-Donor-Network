import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { BLOOD_GROUPS } from '../utils/validation.js';

const router = Router();

// Every route below requires a logged-in donor — a requester or admin token
// gets a 403, not a peek at donor-only data.
router.use(authenticate, authorize('donor'));

// GET /api/donors/me
router.get('/me', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.city,
              dp.blood_group, dp.last_donation_date, dp.is_available, dp.is_blood_group_verified
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
