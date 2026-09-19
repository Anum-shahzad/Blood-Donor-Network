import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequestPayload } from '../utils/validation.js';

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

export default router;
