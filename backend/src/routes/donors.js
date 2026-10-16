import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { BLOOD_GROUPS, validateDonationDate } from '../utils/validation.js';
import { EFFECTIVE_EXPIRY_SQL, defaultTtlHours } from '../services/requestLifecycle.js';
import { getCompatibleDonorGroups } from '../services/matching/compatibility.js';
import { computeCooldownInfo } from '../services/matching/donorState.js';
import { cancelCommitment, advanceCommitmentStep, recordDonation } from '../services/donorCommitment.js';

const router = Router();

// Every route below requires a logged-in donor — a requester or admin token
// gets a 403, not a peek at donor-only data.
router.use(authenticate, authorize('donor'));

// GET /api/donors/me — returns donor profile, cooldown calculation, active commitment, and settings
router.get('/me', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.city,
              dp.blood_group, dp.last_donation_date, dp.is_available, dp.is_blood_group_verified,
              dp.current_status, dp.committed_request_id, dp.commitment_started_at,
              dp.commitment_ended_at, dp.cooldown_until,
              COALESCE(dp.phone_masked, TRUE) AS phone_masked,
              COALESCE(dp.auto_cooldown_lock, TRUE) AS auto_cooldown_lock,
              COALESCE(dp.alert_radius, 10) AS alert_radius,
              COALESCE(dp.notify_whatsapp, TRUE) AS notify_whatsapp,
              COALESCE(dp.notify_sms, TRUE) AS notify_sms,
              COALESCE(dp.notify_inapp, TRUE) AS notify_inapp,
              COALESCE(dp.preferred_language, 'en') AS preferred_language
       FROM users u
       LEFT JOIN donor_profiles dp ON dp.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Donor account not found' });
    }

    const donor = rows[0];
    const cooldownInfo = computeCooldownInfo(donor.last_donation_date, 90);

    let totalDonations = 0;
    try {
      const [countRows] = await pool.query(
        'SELECT COUNT(*) AS total FROM donations WHERE donor_id = ?',
        [req.user.id]
      );
      totalDonations = Number(countRows[0]?.total || 0);
    } catch {
      totalDonations = donor.last_donation_date ? 1 : 0;
    }

    let committedRequest = null;
    if (donor.committed_request_id) {
      // The request's contact_phone is the only contact detail the donor
      // dashboard shows after acceptance. It is released only to the donor
      // who actually accepted THIS request (an 'accepted' response row for
      // the authenticated user) and only while the request is still in
      // 'donor_accepted'. The requester's account phone and email are never
      // sent to donors.
      const [reqRows] = await pool.query(
        `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
                r.required_by, r.status, r.patient_case,
                CASE
                  WHEN r.status = 'donor_accepted'
                   AND EXISTS (
                     SELECT 1 FROM request_responses rr
                     WHERE rr.request_id = r.id AND rr.donor_id = ? AND rr.status = 'accepted'
                   )
                  THEN r.contact_phone
                  ELSE NULL
                END AS contact_phone,
                r.attendant_name,
                u.name AS requester_name
         FROM requests r
         JOIN users u ON u.id = r.requester_id
         WHERE r.id = ?`,
        [req.user.id, donor.committed_request_id]
      );
      committedRequest = reqRows[0] || null;
    }

    res.json({
      ...donor,
      cooldown_info: cooldownInfo,
      total_donations: totalDonations,
      lives_saved: totalDonations * 3,
      committed_request: committedRequest,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/donors/matches — compatible, currently-open emergency requests
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
    if (donorProfile.current_status !== 'AVAILABLE') {
      return res.json({ matches: [], reason: `You are currently ${donorProfile.current_status.toLowerCase().replace(/_/g, ' ')}` });
    }
    if (!donorProfile.is_available) {
      return res.json({ matches: [], reason: 'You have marked yourself unavailable — turn availability on to see requests' });
    }

    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.required_by, r.status, r.created_at, r.patient_case,
              r.attendant_name, r.prescription_slip, u.name AS requester_name
       FROM requests r
       JOIN users u ON u.id = r.requester_id
       WHERE r.is_verified = TRUE
         AND r.status IN ('verified', 'matched')
         AND ${EFFECTIVE_EXPIRY_SQL} > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM request_responses rr
           WHERE rr.request_id = r.id AND rr.donor_id = ?
         )
       ORDER BY
         FIELD(r.urgency, 'critical', 'high', 'medium', 'low'),
         r.created_at ASC`,
      [defaultTtlHours(), req.user.id]
    );

    const matches = rows.filter((r) =>
      getCompatibleDonorGroups(r.blood_group).includes(donorProfile.blood_group)
    );

    res.json({ matches, match_count: matches.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/donors/me/donations — returns verified donation history for cooldown tracking
router.get('/me/donations', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, donation_date, hospital_name, units, blood_group, recipient_case, is_verified, created_at
       FROM donations
       WHERE donor_id = ?
       ORDER BY donation_date DESC, created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/donors/me/donations — log a new or past donation & activate 90-day cooldown
router.post('/me/donations', async (req, res, next) => {
  try {
    const { donation_date, hospital_name, recipient_case, units, request_id } = req.body;
    if (!donation_date) {
      return res.status(400).json({ error: 'donation_date is required' });
    }
    const dateError = validateDonationDate(donation_date);
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }
    if (!hospital_name || !hospital_name.trim()) {
      return res.status(400).json({ error: 'hospital_name is required' });
    }

    const result = await recordDonation(req.user.id, {
      donation_date,
      hospital_name,
      recipient_case,
      units: Number(units) || 1,
      request_id: request_id ? Number(request_id) : null,
    });

    res.status(201).json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/donors/me/commitment/step — advance commitment journey (EN_ROUTE, ARRIVED, DONATING)
router.patch('/me/commitment/step', async (req, res, next) => {
  try {
    const { step } = req.body;
    if (!step) {
      return res.status(400).json({ error: 'step is required' });
    }
    const result = await advanceCommitmentStep(req.user.id, step);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/donors/me/commitment/cancel — back out of an accepted request before travelling
router.post('/me/commitment/cancel', async (req, res, next) => {
  try {
    const result = await cancelCommitment(req.user.id);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/donors/me/settings — save donor preferences, alert radius, privacy, notifications
router.patch('/me/settings', async (req, res, next) => {
  try {
    const {
      phone_masked,
      auto_cooldown_lock,
      alert_radius,
      notify_whatsapp,
      notify_sms,
      notify_inapp,
      preferred_language,
    } = req.body;

    await pool.query(
      `UPDATE donor_profiles
       SET phone_masked = COALESCE(?, phone_masked),
           auto_cooldown_lock = COALESCE(?, auto_cooldown_lock),
           alert_radius = COALESCE(?, alert_radius),
           notify_whatsapp = COALESCE(?, notify_whatsapp),
           notify_sms = COALESCE(?, notify_sms),
           notify_inapp = COALESCE(?, notify_inapp),
           preferred_language = COALESCE(?, preferred_language)
       WHERE user_id = ?`,
      [
        typeof phone_masked === 'boolean' ? phone_masked : null,
        typeof auto_cooldown_lock === 'boolean' ? auto_cooldown_lock : null,
        typeof alert_radius === 'number' ? alert_radius : null,
        typeof notify_whatsapp === 'boolean' ? notify_whatsapp : null,
        typeof notify_sms === 'boolean' ? notify_sms : null,
        typeof notify_inapp === 'boolean' ? notify_inapp : null,
        typeof preferred_language === 'string' ? preferred_language : null,
        req.user.id,
      ]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/donors/me — create or update the donor_profiles row
router.put('/me', async (req, res, next) => {
  try {
    const { blood_group, last_donation_date } = req.body;

    if (!BLOOD_GROUPS.includes(blood_group)) {
      return res.status(400).json({ error: `blood_group must be one of: ${BLOOD_GROUPS.join(', ')}` });
    }
    if (last_donation_date) {
      const dateError = validateDonationDate(last_donation_date);
      if (dateError) {
        return res.status(400).json({ error: dateError });
      }
    }

    const [existingRows] = await pool.query(
      'SELECT blood_group, current_status FROM donor_profiles WHERE user_id = ?',
      [req.user.id]
    );
    const existing = existingRows[0];
    if (existing && existing.blood_group !== blood_group && existing.current_status !== 'AVAILABLE') {
      return res.status(409).json({ error: 'You cannot change your blood group while committed to an emergency' });
    }

    await pool.query(
      `INSERT INTO donor_profiles (user_id, blood_group, last_donation_date)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_blood_group_verified = IF(blood_group <> VALUES(blood_group), FALSE, is_blood_group_verified),
         blood_group = VALUES(blood_group),
         last_donation_date = VALUES(last_donation_date)`,
      [req.user.id, blood_group, last_donation_date || null]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/donors/me/availability — quick toggle
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
