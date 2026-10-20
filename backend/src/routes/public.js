import { Router } from 'express';
import { pool } from '../config/db.js';
import { EFFECTIVE_EXPIRY_SQL, defaultTtlHours } from '../services/requestLifecycle.js';
import { UNIT_PROGRESS_COLUMNS_SQL, OPEN_UNITS_CONDITION_SQL, withUnitProgress } from '../services/requestUnits.js';

const router = Router();

// GET /api/public/emergencies — no login required; powers the landing page
// and the public Emergency page.
//
// Only requests an admin has verified AND that are still open are listed, so
// an unverified or fake request can never appear on the public site. Nothing
// personal is exposed: no requester name, email or phone — just what a
// would-be donor needs to decide whether to sign up and help.
router.get('/emergencies', async (req, res, next) => {
  try {
    const ttl = defaultTtlHours();
    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city,
              r.urgency, r.required_by, r.created_at,
              ${UNIT_PROGRESS_COLUMNS_SQL}
         FROM requests r
        WHERE r.is_verified = TRUE
          AND r.status IN ('verified', 'matched', 'donor_accepted')
          AND ${OPEN_UNITS_CONDITION_SQL}
          AND ${EFFECTIVE_EXPIRY_SQL} > NOW()
        ORDER BY FIELD(r.urgency, 'critical', 'high', 'medium', 'low'),
                 ${EFFECTIVE_EXPIRY_SQL} ASC
        LIMIT 50`,
      [ttl, ttl]
    );

    res.set('Cache-Control', 'public, max-age=15');
    res.json({ requests: rows.map(withUnitProgress), generated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

export default router;
