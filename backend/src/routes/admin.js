import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { BLOOD_GROUPS } from '../utils/validation.js';

const router = Router();

// Every route here requires a logged-in admin
router.use(authenticate, authorize('admin'));

// GET /api/admin/analytics — Sukkur Network real-time aggregation metrics
router.get('/analytics', async (req, res, next) => {
  try {
    // 1. Overall stats
    const [[requestStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_requests,
         SUM(CASE WHEN is_verified = FALSE AND status = 'pending' THEN 1 ELSE 0 END) AS pending_verifications,
         SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) AS fulfilled_requests,
         SUM(CASE WHEN status IN ('pending', 'verified', 'matched', 'donor_accepted') THEN 1 ELSE 0 END) AS active_requests,
         COALESCE(SUM(units_needed), 0) AS total_units_needed
       FROM requests`
    );

    const [[donorStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_donors,
         SUM(CASE WHEN is_available = TRUE AND current_status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available_donors,
         SUM(CASE WHEN is_blood_group_verified = TRUE THEN 1 ELSE 0 END) AS verified_donors,
         SUM(CASE WHEN current_status = 'COOLDOWN' THEN 1 ELSE 0 END) AS in_cooldown_donors
       FROM donor_profiles`
    );

    // 2. Supply vs Demand by blood group
    const [supplyDemandRows] = await pool.query(
      `SELECT
         bg.blood_group,
         COALESCE(req.units_needed, 0) AS units_needed,
         COALESCE(don.available_donors, 0) AS available_donors
       FROM (
         SELECT 'O-' AS blood_group UNION SELECT 'O+' UNION SELECT 'A-' UNION SELECT 'A+'
         UNION SELECT 'B-' UNION SELECT 'B+' UNION SELECT 'AB-' UNION SELECT 'AB+'
       ) bg
       LEFT JOIN (
         SELECT blood_group, SUM(units_needed) AS units_needed
         FROM requests
         WHERE status IN ('pending', 'verified', 'matched', 'donor_accepted')
         GROUP BY blood_group
       ) req ON req.blood_group = bg.blood_group
       LEFT JOIN (
         SELECT blood_group, COUNT(*) AS available_donors
         FROM donor_profiles
         WHERE is_available = TRUE AND current_status = 'AVAILABLE'
         GROUP BY blood_group
       ) don ON don.blood_group = bg.blood_group
       ORDER BY bg.blood_group ASC`
    );

    // 3. Zone / City breakdown
    const [areaRows] = await pool.query(
      `SELECT
         COALESCE(city, 'Unknown') AS area,
         COUNT(*) AS total_requests,
         SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) AS fulfilled_count
       FROM requests
       GROUP BY city
       ORDER BY total_requests DESC
       LIMIT 8`
    );

    // 4. Fulfillment rate calculation
    const totalReq = Number(requestStats?.total_requests || 0);
    const fulfilledReq = Number(requestStats?.fulfilled_requests || 0);
    const fulfillmentRate = totalReq > 0 ? Math.round((fulfilledReq / totalReq) * 100) : 0;

    res.json({
      summary: {
        total_requests: totalReq,
        active_requests: Number(requestStats?.active_requests || 0),
        pending_verifications: Number(requestStats?.pending_verifications || 0),
        fulfilled_requests: fulfilledReq,
        fulfillment_rate_percent: fulfillmentRate,
        total_donors: Number(donorStats?.total_donors || 0),
        available_donors: Number(donorStats?.available_donors || 0),
        verified_donors: Number(donorStats?.verified_donors || 0),
        in_cooldown_donors: Number(donorStats?.in_cooldown_donors || 0),
      },
      blood_group_balance: supplyDemandRows,
      area_distribution: areaRows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/requests — all requests, unverified ones first
router.get('/requests', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.required_by, r.status, r.is_verified, r.created_at,
              r.patient_case, r.contact_phone, r.attendant_name, r.prescription_slip,
              u.name AS requester_name, u.email AS requester_email, u.phone AS requester_phone
       FROM requests r
       JOIN users u ON u.id = r.requester_id
       ORDER BY r.is_verified ASC, r.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/requests/:id/verify — verify or un-verify a request
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

// PATCH /api/admin/requests/:id/reject — reject / cancel a fraudulent or invalid request
router.patch('/requests/:id/reject', async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const [result] = await pool.query(
      `UPDATE requests SET status = 'cancelled', is_verified = FALSE WHERE id = ?`,
      [requestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json({ status: 'ok', message: 'Request rejected and cancelled' });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/donors — donor registry with verification, cooldown, and suspension info
router.get('/donors', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.city, COALESCE(u.is_suspended, FALSE) AS is_suspended,
              dp.blood_group, dp.is_available, dp.is_blood_group_verified, dp.last_donation_date,
              dp.current_status, dp.committed_request_id, dp.cooldown_until
       FROM donor_profiles dp
       JOIN users u ON u.id = dp.user_id
       ORDER BY dp.is_blood_group_verified ASC, u.name ASC`
    );

    // Enrich with donation counts
    const enriched = await Promise.all(
      rows.map(async (d) => {
        try {
          const [cnt] = await pool.query('SELECT COUNT(*) AS total FROM donations WHERE donor_id = ?', [d.id]);
          return { ...d, total_donations: cnt[0]?.total || 0 };
        } catch {
          return { ...d, total_donations: 0 };
        }
      })
    );

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/donors/:id/verify — confirm/unconfirm donor's blood group
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

// PATCH /api/admin/donors/:id/status — suspend or reinstate an account for compliance.
// Despite the path, this works on donor AND requester accounts (it targets
// users.id). Admin accounts can never be suspended: otherwise the last admin
// could lock everyone, including themselves, out of the moderation workflow.
// The flag is enforced on every protected request by middleware/auth.js.
router.patch('/donors/:id/status', async (req, res, next) => {
  try {
    const targetUserId = Number(req.params.id);
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const { is_suspended } = req.body;
    if (typeof is_suspended !== 'boolean') {
      return res.status(400).json({ error: 'is_suspended must be true or false' });
    }

    const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [targetUserId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (rows[0].role === 'admin') {
      return res.status(403).json({ error: 'Administrator accounts cannot be suspended' });
    }

    await pool.query('UPDATE users SET is_suspended = ? WHERE id = ?', [is_suspended, targetUserId]);
    res.json({ status: 'ok', is_suspended });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/fraud-reports — abuse detection, rate limit breaches, and submitted reports
router.get('/fraud-reports', async (req, res, next) => {
  try {
    let reports = [];
    try {
      const [rows] = await pool.query(
        `SELECT fr.id, fr.report_type, fr.details, fr.status, fr.created_at,
                u.name AS target_user_name, u.email AS target_user_email,
                r.hospital_name AS request_hospital, r.blood_group AS request_blood_group
         FROM fraud_reports fr
         LEFT JOIN users u ON u.id = fr.target_user_id
         LEFT JOIN requests r ON r.id = fr.target_request_id
         ORDER BY fr.created_at DESC`
      );
      reports = rows;
    } catch {
      reports = [];
    }

    // Dynamic audit check: find requesters who posted > 2 requests in 24 hours
    const [rateLimitFlags] = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email, u.phone, COUNT(*) AS request_count_24h
       FROM requests r
       JOIN users u ON u.id = r.requester_id
       WHERE r.created_at >= NOW() - INTERVAL 1 DAY
       GROUP BY u.id, u.name, u.email, u.phone
       HAVING request_count_24h >= 2
       ORDER BY request_count_24h DESC`
    );

    res.json({
      reports,
      rate_limit_flags: rateLimitFlags,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/fraud-reports/:id — update report status
router.patch('/fraud-reports/:id', async (req, res, next) => {
  try {
    const reportId = Number(req.params.id);
    const { status } = req.body;
    const valid = ['pending', 'investigating', 'resolved', 'dismissed'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
    }

    await pool.query('UPDATE fraud_reports SET status = ? WHERE id = ?', [status, reportId]);
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/policies — system policies & configurations
router.get('/policies', async (req, res, next) => {
  try {
    let rows = [];
    try {
      const [resRows] = await pool.query('SELECT policy_key, policy_value FROM system_policies');
      rows = resRows;
    } catch {
      rows = [];
    }

    const defaultPolicies = {
      cooldown_days: '90',
      max_requests_per_day: '3',
      sms_gateway_enabled: 'true',
      allowed_zones: 'Sukkur IBA Area, Minara Road / Civil Hospital, Military Road / Cantonment, Rohri City, Pano Aqil',
    };

    rows.forEach((r) => {
      defaultPolicies[r.policy_key] = r.policy_value;
    });

    res.json(defaultPolicies);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/policies — save updated system policies
router.put('/policies', async (req, res, next) => {
  try {
    const policies = req.body;
    for (const [key, val] of Object.entries(policies)) {
      await pool.query(
        `INSERT INTO system_policies (policy_key, policy_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE policy_value = VALUES(policy_value)`,
        [key, String(val)]
      );
    }
    res.json({ status: 'ok', policies });
  } catch (err) {
    next(err);
  }
});

export default router;
