import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { BLOOD_GROUPS } from '../utils/validation.js';
import { rejectRequestByAdmin } from '../services/requestLifecycle.js';
import { getVerificationSummaries } from '../services/verification/verificationService.js';

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
         SUM(CASE WHEN current_status = 'COOLDOWN' THEN 1 ELSE 0 END) AS in_cooldown_donors
       FROM donor_profiles`
    );

    // Verified / trusted counts come from approved verification records (the
    // same rules every badge uses), never from the legacy admin toggle.
    const [donorIdRows] = await pool.query('SELECT user_id FROM donor_profiles');
    const summaries = await getVerificationSummaries(donorIdRows.map((r) => r.user_id));
    let identityVerifiedDonors = 0;
    let trustedDonors = 0;
    for (const v of summaries.values()) {
      if (v.identity_verified) identityVerifiedDonors += 1;
      if (v.trusted) trustedDonors += 1;
    }

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
        // Identity-verified donors (admin-approved identity evidence).
        verified_donors: identityVerifiedDonors,
        trusted_donors: trustedDonors,
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

    // One transaction with a row lock, so this can't interleave with a donor
    // accepting the same request (acceptRequest locks the same row).
    const conn = await pool.getConnection();
    let newStatus;
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query('SELECT status FROM requests WHERE id = ? FOR UPDATE', [requestId]);
      const existing = rows[0];
      if (!existing) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }

      // Verification flag and lifecycle status must never disagree:
      //   verify   : pending -> verified; open statuses are unchanged.
      //   un-verify: verified/matched -> pending (back to the review queue),
      //              so nothing "open" is left without verification.
      // A request a donor has already accepted can't be silently flipped
      // (that would strand the committed donor), and a closed request can't
      // be verified back into circulation.
      if (existing.status === 'donor_accepted') {
        await conn.rollback();
        return res.status(409).json({
          error: 'A donor has already accepted this request — reject it instead of changing its verification',
        });
      }
      if (verified && ['fulfilled', 'expired', 'cancelled'].includes(existing.status)) {
        await conn.rollback();
        return res.status(409).json({ error: `A ${existing.status} request cannot be verified` });
      }

      if (verified) {
        newStatus = existing.status === 'pending' ? 'verified' : existing.status;
      } else {
        newStatus = ['verified', 'matched'].includes(existing.status) ? 'pending' : existing.status;
      }

      await conn.query('UPDATE requests SET is_verified = ?, status = ? WHERE id = ?', [
        verified,
        newStatus,
        requestId,
      ]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({ status: 'ok', is_verified: verified, request_status: newStatus });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/requests/:id/reject — reject / cancel a fraudulent or invalid request.
// Runs in one transaction that also releases any donor committed to the
// request. A fulfilled or expired request can't be rejected (409); rejecting an
// already-cancelled request is a safe no-op.
router.patch('/requests/:id/reject', async (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    const result = await rejectRequestByAdmin(requestId);
    res.json({
      status: 'ok',
      message: result.already_closed ? 'Request was already cancelled' : 'Request rejected and cancelled',
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/donors — donor registry with verification, cooldown, and suspension info
router.get('/donors', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.city, COALESCE(u.is_suspended, FALSE) AS is_suspended,
              dp.blood_group, dp.is_available, dp.last_donation_date,
              dp.current_status, dp.committed_request_id, dp.cooldown_until
       FROM donor_profiles dp
       JOIN users u ON u.id = dp.user_id
       ORDER BY u.name ASC`
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

    const summaries = await getVerificationSummaries(enriched.map((d) => d.id));
    const withVerification = enriched
      .map((d) => ({
        ...d,
        // Kept for API compatibility; always false (nothing verifies blood group).
        is_blood_group_verified: false,
        verification: summaries.get(Number(d.id)),
      }))
      // Least-verified first, like the old ordering, then by name.
      .sort((a, b) => a.verification.level - b.verification.level || String(a.name).localeCompare(String(b.name)));

    res.json(withVerification);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/donors/:id/verify — REMOVED.
// A manual toggle let an admin mark a donor "verified" with no evidence, which
// misrepresented what was checked. Verification now only comes from reviewing
// submitted documents (POST /api/admin/verification/submissions/:id/approve).
// The route stays (admin-only) so old clients get a clear answer, not a 404.
router.patch('/donors/:id/verify', (req, res) => {
  res.status(410).json({
    error:
      'Manual donor verification has been removed. Review the donor\'s submitted identity document under ID Review instead.',
    code: 'MANUAL_VERIFICATION_REMOVED',
  });
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

export default router;
