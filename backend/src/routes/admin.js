import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Every route here requires a logged-in admin.
router.use(authenticate, authorize('admin'));

// GET /api/admin/requests — every request, unverified ones first so an
// admin sees what needs attention without hunting for it.
router.get('/requests', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.status, r.is_verified, r.created_at,
              u.name AS requester_name, u.email AS requester_email
       FROM requests r
       JOIN users u ON u.id = r.requester_id
       ORDER BY r.is_verified ASC, r.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/requests/:id/verify — mark a request as a genuine
// emergency. Verifying a still-pending request also advances it to
// 'verified' in the lifecycle; un-verifying never regresses status, since
// status tracks matching progress, not verification.
router.patch('/requests/:id/verify', async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const { verified } = req.body;
    if (typeof verified !== 'boolean') {
      return res.status(400).json({ error: 'verified must be true or false' });
    }

    const [rows] = await pool.query('SELECT status FROM requests WHERE id = ?', [requestId]);
    const existing = rows[0];
    if (!existing) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const newStatus = verified && existing.status === 'pending' ? 'verified' : existing.status;

    await pool.query('UPDATE requests SET is_verified = ?, status = ? WHERE id = ?', [
      verified,
      newStatus,
      requestId,
    ]);

    res.json({ status: 'ok', is_verified: verified, request_status: newStatus });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/donors — every donor profile, unverified blood groups
// first.
router.get('/donors', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.city,
              dp.blood_group, dp.is_available, dp.is_blood_group_verified, dp.last_donation_date,
              dp.current_status, dp.committed_request_id
       FROM donor_profiles dp
       JOIN users u ON u.id = dp.user_id
       ORDER BY dp.is_blood_group_verified ASC, u.name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/donors/:id/verify — confirm a donor's self-declared
// blood group. This is NOT a medical crossmatch — it just tells requesters
// the platform has some basis for trusting the declared group.
router.patch('/donors/:id/verify', async (req, res, next) => {
  try {
    const donorUserId = Number(req.params.id);
    if (!Number.isInteger(donorUserId)) {
      return res.status(400).json({ error: 'Invalid donor id' });
    }

    const { verified } = req.body;
    if (typeof verified !== 'boolean') {
      return res.status(400).json({ error: 'verified must be true or false' });
    }

    const [result] = await pool.query(
      'UPDATE donor_profiles SET is_blood_group_verified = ? WHERE user_id = ?',
      [verified, donorUserId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Donor profile not found' });
    }

    res.json({ status: 'ok', is_blood_group_verified: verified });
  } catch (err) {
    next(err);
  }
});

export default router;
