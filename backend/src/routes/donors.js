import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { BLOOD_GROUPS, validateDonationDate } from '../utils/validation.js';
import { EFFECTIVE_EXPIRY_SQL, defaultTtlHours } from '../services/requestLifecycle.js';
import { getCompatibleDonorGroups } from '../services/matching/compatibility.js';
import { isEligibleByRecency } from '../services/matching/donorMatching.js';
import { computeCooldownInfo } from '../services/matching/donorState.js';
import { getVerificationSummaries } from '../services/verification/verificationService.js';
import {
  DEFAULT_ALERT_RADIUS_KM, MIN_ALERT_RADIUS_KM, MAX_ALERT_RADIUS_KM, checkRadius, parseCoordinates,
} from '../services/geo.js';
import { cancelCommitment, advanceCommitmentStep, recordDonation, reportDonationUnsuccessful } from '../services/donorCommitment.js';
import { UNIT_PROGRESS_COLUMNS_SQL, OPEN_UNITS_CONDITION_SQL, withUnitProgress } from '../services/requestUnits.js';

const router = Router();

// Every route below requires a logged-in donor — a requester or admin token
// gets a 403, not a peek at donor-only data.
router.use(authenticate, authorize('donor'));

// GET /api/donors/me — returns donor profile, cooldown calculation, active commitment, and settings
router.get('/me', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.city,
              dp.blood_group, dp.last_donation_date, dp.is_available,
              dp.current_status, dp.committed_request_id, dp.commitment_started_at,
              dp.commitment_ended_at, dp.cooldown_until,
              COALESCE(dp.phone_masked, TRUE) AS phone_masked,
              COALESCE(dp.alert_radius, 10) AS alert_radius,
              dp.latitude, dp.longitude,
              COALESCE(dp.notify_inapp, TRUE) AS notify_inapp,
              COALESCE(dp.notify_browser, TRUE) AS notify_browser,
              COALESCE(dp.notify_push, TRUE) AS notify_push
       FROM users u
       LEFT JOIN donor_profiles dp ON dp.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Donor account not found' });
    }

    // The donor's saved coordinates are only used to say which location mode
    // is active; the raw numbers are not sent back.
    const { latitude: savedLat, longitude: savedLng, ...donor } = rows[0];
    donor.location_mode = savedLat != null && savedLng != null ? 'gps' : 'city';
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
                (SELECT rr2.committed_units FROM request_responses rr2
                  WHERE rr2.request_id = r.id AND rr2.donor_id = ? AND rr2.status = 'accepted') AS my_committed_units,
                ${UNIT_PROGRESS_COLUMNS_SQL},
                u.name AS requester_name
         FROM requests r
         JOIN users u ON u.id = r.requester_id
         WHERE r.id = ?`,
        [req.user.id, req.user.id, donor.committed_request_id]
      );
      committedRequest = reqRows[0] ? withUnitProgress(reqRows[0]) : null;
    }

    const verification = (await getVerificationSummaries([req.user.id])).get(Number(req.user.id));

    res.json({
      ...donor,
      // Derived from approved verification records only. The legacy column is
      // never read; kept in the payload (always false) for API compatibility.
      is_blood_group_verified: false,
      verification,
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
      `SELECT dp.blood_group, dp.current_status, dp.is_available, dp.last_donation_date,
              dp.alert_radius, dp.latitude, dp.longitude, u.city
         FROM donor_profiles dp
         JOIN users u ON u.id = dp.user_id
        WHERE dp.user_id = ?`,
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

    // A request is hidden only once this donor has ANSWERED it (declined /
    // accepted). A 'notified' row means a requester alerted this donor, which
    // must surface the request, not hide it (audit L-03).
    const [rows] = await pool.query(
      `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency,
              r.required_by, r.status, r.created_at, r.patient_case,
              r.attendant_name, r.prescription_slip, u.name AS requester_name,
              r.latitude AS request_latitude, r.longitude AS request_longitude,
              EXISTS (
                SELECT 1 FROM request_responses rn
                 WHERE rn.request_id = r.id AND rn.donor_id = ? AND rn.status = 'notified'
              ) AS alerted_me,
              ${UNIT_PROGRESS_COLUMNS_SQL}
       FROM requests r
       JOIN users u ON u.id = r.requester_id
       WHERE r.is_verified = TRUE
         AND r.status IN ('verified', 'matched', 'donor_accepted')
         AND ${OPEN_UNITS_CONDITION_SQL}
         AND ${EFFECTIVE_EXPIRY_SQL} > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM request_responses rr
           WHERE rr.request_id = r.id AND rr.donor_id = ?
             AND rr.status IN ('declined', 'accepted', 'donated', 'failed', 'cancelled')
         )
       ORDER BY
         FIELD(r.urgency, 'critical', 'high', 'medium', 'low'),
         r.created_at ASC`,
      [req.user.id, defaultTtlHours(), req.user.id]
    );

    // Same eligibility acceptRequest() and the alert rules enforce: compatible
    // blood group and outside the post-donation cooldown, so the list never
    // shows a request the donor would be refused on accept.
    const compatible = isEligibleByRecency(donorProfile.last_donation_date)
      ? rows.map(withUnitProgress).filter((r) => getCompatibleDonorGroups(r.blood_group).includes(donorProfile.blood_group))
      : [];

    // Distance rule: only requests inside the donor's chosen Maximum Alert
    // Radius are listed. Distance is measured from the donor's saved location
    // (or their city centre) to the request's pinned location (or its city
    // centre). A request a requester explicitly alerted this donor about is
    // always shown, whatever the distance. See services/geo.js.
    const radiusKm = Number(donorProfile.alert_radius) || DEFAULT_ALERT_RADIUS_KM;
    const donorPlace = {
      latitude: donorProfile.latitude,
      longitude: donorProfile.longitude,
      city: donorProfile.city,
    };
    const matches = [];
    let hiddenByDistance = 0;
    for (const r of compatible) {
      const { request_latitude, request_longitude, alerted_me, ...row } = r;
      const within = checkRadius({
        donor: donorPlace,
        request: { latitude: request_latitude, longitude: request_longitude, city: row.city },
        radiusKm,
      });
      if (!within.ok && !Number(alerted_me)) {
        hiddenByDistance += 1;
        continue;
      }
      matches.push({ ...row, distance_km: within.km, distance_approximate: within.approximate });
    }

    const payload = {
      matches,
      match_count: matches.length,
      alert_radius_km: radiusKm,
      location_mode: donorProfile.latitude != null && donorProfile.longitude != null ? 'gps' : 'city',
      hidden_by_distance: hiddenByDistance,
    };
    if (matches.length === 0 && hiddenByDistance > 0) {
      payload.reason = `No requests within ${radiusKm} km. ${hiddenByDistance} compatible request${hiddenByDistance === 1 ? ' is' : 's are'} further away — raise your alert radius in Settings to see ${hiddenByDistance === 1 ? 'it' : 'them'}.`;
    }
    res.json(payload);
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

// POST /api/donors/me/donations — log a donation & activate 90-day cooldown (all rules enforced in recordDonation)
router.post('/me/donations', async (req, res, next) => {
  try {
    const { donation_date, hospital_name, recipient_case, units, request_id } = req.body || {};
    if (!donation_date) {
      return res.status(400).json({ error: 'donation_date is required' });
    }
    const dateError = validateDonationDate(donation_date, 'donation_date');
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }
    if (typeof hospital_name !== 'string' || !hospital_name.trim()) {
      return res.status(400).json({ error: 'hospital_name is required' });
    }

    // request_id is only a consistency check — recordDonation uses the
    // donor's own server-side commitment, never the id sent by the client,
    // and re-validates everything (dates, duplicates, request state, units).
    const result = await recordDonation(req.user.id, {
      donation_date,
      hospital_name,
      recipient_case,
      units,
      request_id,
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

// POST /api/donors/me/commitment/unsuccessful — report that your donation did not
// happen or did not succeed; your promised units are released to other donors
router.post('/me/commitment/unsuccessful', async (req, res, next) => {
  try {
    const result = await reportDonationUnsuccessful(req.user.id);
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
      alert_radius,
      notify_inapp,
      notify_browser,
      notify_push,
    } = req.body;

    if (alert_radius !== undefined && alert_radius !== null) {
      if (
        typeof alert_radius !== 'number' ||
        !Number.isInteger(alert_radius) ||
        alert_radius < MIN_ALERT_RADIUS_KM ||
        alert_radius > MAX_ALERT_RADIUS_KM
      ) {
        return res.status(400).json({
          error: `alert_radius must be a whole number of km between ${MIN_ALERT_RADIUS_KM} and ${MAX_ALERT_RADIUS_KM}`,
        });
      }
    }

    await pool.query(
      `UPDATE donor_profiles
       SET phone_masked = COALESCE(?, phone_masked),
           alert_radius = COALESCE(?, alert_radius),
           notify_inapp = COALESCE(?, notify_inapp),
           notify_browser = COALESCE(?, notify_browser),
           notify_push = COALESCE(?, notify_push)
       WHERE user_id = ?`,
      [
        typeof phone_masked === 'boolean' ? phone_masked : null,
        typeof alert_radius === 'number' ? alert_radius : null,
        typeof notify_inapp === 'boolean' ? notify_inapp : null,
        typeof notify_browser === 'boolean' ? notify_browser : null,
        typeof notify_push === 'boolean' ? notify_push : null,
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
    const { blood_group, last_donation_date } = req.body || {};

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
      'SELECT blood_group, current_status, last_donation_date FROM donor_profiles WHERE user_id = ?',
      [req.user.id]
    );
    const existing = existingRows[0];
    if (existing && existing.blood_group !== blood_group && existing.current_status !== 'AVAILABLE') {
      return res.status(409).json({ error: 'You cannot change your blood group while committed to an emergency' });
    }

    // The last-donation date drives the cooldown, so profile edits may never
    // be used to shorten it. An omitted/empty date keeps the stored one (it
    // is NOT cleared), and a supplied date can't be earlier than the latest
    // date already on record (profile value or any logged donation).
    let newestKnown = existing?.last_donation_date ? String(existing.last_donation_date).slice(0, 10) : null;
    const [latestRows] = await pool.query(
      'SELECT MAX(donation_date) AS latest FROM donations WHERE donor_id = ?',
      [req.user.id]
    );
    const latestLogged = latestRows[0]?.latest ? String(latestRows[0].latest).slice(0, 10) : null;
    if (latestLogged && (!newestKnown || latestLogged > newestKnown)) newestKnown = latestLogged;

    if (last_donation_date && newestKnown && last_donation_date < newestKnown) {
      return res.status(409).json({
        error: `Your last donation date cannot be set earlier than ${newestKnown}, which is already on record.`,
      });
    }

    await pool.query(
      `INSERT INTO donor_profiles (user_id, blood_group, last_donation_date)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_blood_group_verified = IF(blood_group <> VALUES(blood_group), FALSE, is_blood_group_verified),
         blood_group = VALUES(blood_group),
         last_donation_date = CASE
           WHEN VALUES(last_donation_date) IS NULL THEN last_donation_date
           WHEN last_donation_date IS NULL THEN VALUES(last_donation_date)
           ELSE GREATEST(last_donation_date, VALUES(last_donation_date))
         END`,
      [req.user.id, blood_group, last_donation_date || null]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/donors/me/location — set or clear the location used for the alert radius.
//   { latitude, longitude } saves a GPS point (rounded to ~100 m);
//   { clear: true } goes back to using the donor's city centre.
// The coordinates are private: they are only used to measure distance and are
// never returned to requesters.
router.put('/me/location', async (req, res, next) => {
  try {
    const { latitude, longitude, clear } = req.body || {};

    let lat = null;
    let lng = null;
    if (clear !== true) {
      const coords = parseCoordinates(latitude, longitude);
      if (!coords.ok || coords.none) {
        return res.status(400).json({ error: coords.error || 'latitude and longitude are required' });
      }
      lat = Math.round(coords.latitude * 1000) / 1000;
      lng = Math.round(coords.longitude * 1000) / 1000;
    }

    const [result] = await pool.query(
      'UPDATE donor_profiles SET latitude = ?, longitude = ? WHERE user_id = ?',
      [lat, lng, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No donor profile yet — set your blood group first' });
    }
    res.json({ status: 'ok', location_mode: lat === null ? 'city' : 'gps' });
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
