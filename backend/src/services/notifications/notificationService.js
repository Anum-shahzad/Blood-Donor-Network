// Urgent-alert notifications: creation, Web Push dispatch and the donor's feed.
//
// Flow (called from POST /api/requests/:id/alert/:donorId):
//   1. createUrgentAlertNotification()  - inside the alert transaction. Re-evaluates
//      eligibility on the server (radius, units, expiry, availability, preferences)
//      and saves ONE notification row (unique dedupe_key).
//   2. sendPushForNotification()        - after commit. Sends a real Web Push to the
//      donor's subscriptions and records every attempt in push_deliveries.
//   3. getUnreadForDonor()              - polled by the dashboard (in-app popup,
//      sound, browser notification). Re-checks eligibility on every poll.
import { pool } from '../../config/db.js';
import { defaultTtlHours, EFFECTIVE_EXPIRY_SQL } from '../requestLifecycle.js';
import { UNIT_PROGRESS_COLUMNS_SQL, OPEN_UNITS_CONDITION_SQL, withUnitProgress } from '../requestUnits.js';
import { evaluateNotification, buildNotificationContent, requestUrl } from './notificationRules.js';
import { isPushConfigured, sendPush } from './webPush.js';

export const NOTIFICATION_TYPE_URGENT = 'urgent_alert';
// A notification stops being offered after this long, whatever its read state.
const FEED_WINDOW_HOURS = 24;
const MAX_FAILURES_BEFORE_REMOVAL = 5;

const DONOR_COLUMNS_SQL = `
  u.id AS user_id, u.role, u.is_suspended, u.city,
  dp.blood_group, dp.is_available, dp.current_status, dp.last_donation_date,
  dp.alert_radius, dp.latitude, dp.longitude,
  dp.notify_inapp, dp.notify_browser, dp.notify_push`;

function splitDonor(row) {
  if (!row) return null;
  return {
    account: { id: row.user_id, role: row.role, is_suspended: row.is_suspended, city: row.city },
    profile: {
      blood_group: row.blood_group, is_available: row.is_available, current_status: row.current_status,
      last_donation_date: row.last_donation_date, alert_radius: row.alert_radius,
      latitude: row.latitude, longitude: row.longitude,
      notify_inapp: row.notify_inapp, notify_browser: row.notify_browser, notify_push: row.notify_push,
    },
  };
}

async function loadDonor(conn, donorId) {
  const [rows] = await conn.query(
    `SELECT ${DONOR_COLUMNS_SQL}
       FROM users u LEFT JOIN donor_profiles dp ON dp.user_id = u.id
      WHERE u.id = ?`,
    [donorId]
  );
  return splitDonor(rows[0]);
}

async function loadRequest(conn, requestId) {
  const [rows] = await conn.query(
    `SELECT r.id, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency, r.required_by,
            r.status, r.is_verified, r.created_at, r.latitude, r.longitude,
            ${UNIT_PROGRESS_COLUMNS_SQL}
       FROM requests r WHERE r.id = ?`,
    [requestId]
  );
  return rows[0] ? withUnitProgress(rows[0]) : null;
}

// Runs on the alert transaction's connection, after the 'notified' response row
// was inserted. Never throws for "not eligible": it returns { created: false, reason }.
// The caller decides what to tell the requester; the reason is internal.
export async function createUrgentAlertNotification(conn, { requestId, donorId }) {
  const [request, donor] = await Promise.all([loadRequest(conn, requestId), loadDonor(conn, donorId)]);
  const verdict = evaluateNotification({ request, donor, ttlHours: defaultTtlHours() });
  if (!verdict.ok) return { created: false, reason: verdict.reason };

  const dedupeKey = `${NOTIFICATION_TYPE_URGENT}:${requestId}:${donorId}`;
  const [result] = await conn.query(
    `INSERT IGNORE INTO notifications
       (user_id, type, request_id, dedupe_key, channel_inapp, channel_browser, channel_push)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [donorId, NOTIFICATION_TYPE_URGENT, requestId, dedupeKey,
      verdict.channels.inapp, verdict.channels.browser, verdict.channels.push]
  );
  if (result.affectedRows === 0) return { created: false, reason: 'duplicate' };
  return { created: true, notificationId: result.insertId, channels: verdict.channels };
}

// Sends the Web Push for an already-saved notification. Safe to call more than
// once: a subscription that already has an 'accepted' delivery is skipped, so a
// retry can never double-notify. Never throws.
//
// Counts are about the PUSH SERVICE only: "accepted" means FCM / Mozilla / Apple
// took the message, not that the donor saw it.
export async function sendPushForNotification(notificationId) {
  const summary = { configured: isPushConfigured(), subscriptions: 0, accepted: 0, failed: 0, expired: 0, skipped: 0 };
  try {
    const [nRows] = await pool.query(
      'SELECT id, user_id, request_id, channel_push, read_at FROM notifications WHERE id = ?',
      [notificationId]
    );
    const n = nRows[0];
    if (!n || !n.channel_push || n.read_at) return { ...summary, skipped: 1 };
    if (!summary.configured) return summary;

    // Re-check everything at send time, not just at creation time.
    const [request, donor] = await Promise.all([loadRequest(pool, n.request_id), loadDonor(pool, n.user_id)]);
    const verdict = evaluateNotification({ request, donor, ttlHours: defaultTtlHours() });
    if (!verdict.ok || !verdict.channels.push) return { ...summary, skipped: 1 };

    const [subs] = await pool.query(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.failure_count,
              (SELECT COUNT(*) FROM push_deliveries d
                WHERE d.notification_id = ? AND d.subscription_id = s.id AND d.status = 'accepted') AS already_sent
         FROM push_subscriptions s WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 5`,
      [notificationId, n.user_id]
    );
    summary.subscriptions = subs.length;

    const content = buildNotificationContent(request);
    const payload = {
      notificationId: n.id,
      requestId: n.request_id,
      title: content.title,
      body: `${content.body} · ${request.units_open} unit${request.units_open === 1 ? '' : 's'} open`,
      tag: `bdn-alert-${n.id}`,       // same tag the in-page notification uses, so one device never shows two
      url: requestUrl(n.request_id, n.id),
      urgency: request.urgency,
    };
    // Push messages are worthless after the request's deadline; let the push
    // service drop them instead of delivering them late.
    const ttlSeconds = 3600;

    await Promise.all(subs.map(async (sub) => {
      if (Number(sub.already_sent) > 0) { summary.skipped += 1; return; }
      const r = await sendPush(sub, payload, { ttlSeconds });
      await pool.query(
        `INSERT INTO push_deliveries (notification_id, subscription_id, status, attempts, http_status, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [notificationId, r.outcome === 'expired' ? null : sub.id, r.outcome, r.attempts, r.httpStatus ?? null, r.error ?? null]
      );
      if (r.outcome === 'accepted') {
        summary.accepted += 1;
        await pool.query('UPDATE push_subscriptions SET last_success_at = NOW(), failure_count = 0 WHERE id = ?', [sub.id]);
      } else if (r.outcome === 'expired') {
        summary.expired += 1;
        await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
      } else {
        summary.failed += 1;
        await pool.query('UPDATE push_subscriptions SET last_failure_at = NOW(), failure_count = failure_count + 1 WHERE id = ?', [sub.id]);
        if (Number(sub.failure_count) + 1 >= MAX_FAILURES_BEFORE_REMOVAL) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
        }
      }
    }));
    return summary;
  } catch (err) {
    console.error('Web Push dispatch failed:', err.message);
    return { ...summary, failed: summary.failed + 1 };
  }
}

// What the donor dashboard polls. Authoritative: every row is re-evaluated with
// the same rules used at creation (radius, availability, cooldown, units,
// expiry, preferences) and requests the donor already answered are dropped.
export async function getUnreadForDonor(donorId, { limit = 10 } = {}) {
  const donor = await loadDonor(pool, donorId);
  if (!donor) return [];

  const [rows] = await pool.query(
    `SELECT n.id, n.request_id, n.created_at AS notified_at,
            r.id AS rid, r.blood_group, r.units_needed, r.hospital_name, r.city, r.urgency, r.required_by,
            r.status, r.is_verified, r.created_at, r.latitude, r.longitude,
            ${UNIT_PROGRESS_COLUMNS_SQL}
       FROM notifications n
       JOIN requests r ON r.id = n.request_id
      WHERE n.user_id = ?
        AND n.type = ?
        AND n.read_at IS NULL
        AND n.created_at > NOW() - INTERVAL ${Number(FEED_WINDOW_HOURS)} HOUR
        AND ${OPEN_UNITS_CONDITION_SQL}
        AND ${EFFECTIVE_EXPIRY_SQL} > NOW()
        AND NOT EXISTS (
          SELECT 1 FROM request_responses rr
           WHERE rr.request_id = r.id AND rr.donor_id = n.user_id
             AND rr.status IN ('declined', 'accepted', 'claimed', 'donated', 'failed', 'cancelled', 'disputed'))
      ORDER BY n.id DESC
      LIMIT ?`,
    [donorId, NOTIFICATION_TYPE_URGENT, defaultTtlHours(), Math.min(Math.max(Number(limit) || 10, 1), 25)]
  );

  const ttl = defaultTtlHours();
  const out = [];
  for (const row of rows) {
    const request = withUnitProgress(row);
    const verdict = evaluateNotification({ request, donor, ttlHours: ttl });
    if (!verdict.ok) continue;
    const content = buildNotificationContent(request);
    out.push({
      id: row.id,
      request_id: row.request_id,
      created_at: row.notified_at,
      title: content.title,
      blood_group: request.blood_group,
      urgency: request.urgency,
      hospital_name: request.hospital_name,
      city: request.city,
      units_open: request.units_open,
      units_needed: request.units_needed,
      required_by: request.required_by,
      distance_km: verdict.km,
      url: requestUrl(row.request_id, row.id),
      // Live preferences, so turning a channel off takes effect immediately.
      show_popup: verdict.channels.inapp,
      show_system_notification: verdict.channels.browser,
    });
  }
  return out;
}

export async function markRead(userId, ids) {
  if (!ids.length) return 0;
  const [r] = await pool.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE user_id = ? AND id IN (?)',
    [userId, ids]
  );
  return r.affectedRows;
}

export async function markAcknowledged(userId, id) {
  const [r] = await pool.query(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, NOW()), acknowledged_at = COALESCE(acknowledged_at, NOW())
      WHERE user_id = ? AND id = ?`,
    [userId, id]
  );
  return r.affectedRows;
}

// ---------------------------------------------------------------------------
// Requester notifications: donor progress and donation claims.
//
// These reuse the same `notifications` table, the unique dedupe_key and the
// read/dismiss handling as the donor alerts above. A row is addressed to the
// REQUESTER who owns the request, and is written inside the same transaction
// as the donor's status change, so a status change and its notification are
// saved together or not at all.
//
//   type 'donor_status'    donor moved to EN_ROUTE / ARRIVED
//   type 'donation_claim'  donor claimed a donation and it awaits confirmation
//
// dedupe_key = <type>:<requestId>:<donorId>:<commitmentStartEpoch>:<STATE>
// The key is what makes "one notification per status change" true: a repeated
// call, a retry or a double click hits the unique key and is ignored, while a
// donor who cancels and later re-accepts the same request has a new
// commitment start time and so a new set of keys. The donor id and state are
// read back out of the key, so no schema change is needed.
// Push is never used for these (channel_push = FALSE): requesters do not
// register push devices; they get the in-app card, sound and, if allowed,
// the browser notification.
// ---------------------------------------------------------------------------
export const NOTIFICATION_TYPE_DONOR_STATUS = 'donor_status';
export const NOTIFICATION_TYPE_DONATION_CLAIM = 'donation_claim';
const REQUESTER_NOTIFICATION_TYPES = [NOTIFICATION_TYPE_DONOR_STATUS, NOTIFICATION_TYPE_DONATION_CLAIM];

// Runs on the caller's transaction connection. Returns { created, notificationId }.
export async function createRequesterNotification(conn, { requesterId, requestId, donorId, type, state, commitmentStartedAt }) {
  const epoch = commitmentStartedAt ? Math.floor(new Date(commitmentStartedAt).getTime() / 1000) || 0 : 0;
  const dedupeKey = `${type}:${requestId}:${donorId}:${epoch}:${state}`;
  const [result] = await conn.query(
    `INSERT IGNORE INTO notifications
       (user_id, type, request_id, dedupe_key, channel_inapp, channel_browser, channel_push)
     VALUES (?, ?, ?, ?, TRUE, TRUE, FALSE)`,
    [requesterId, type, requestId, dedupeKey]
  );
  if (result.affectedRows === 0) return { created: false, reason: 'duplicate' };
  return { created: true, notificationId: result.insertId };
}

function describeRequesterNotification(type, state, donorName, hospital) {
  if (type === NOTIFICATION_TYPE_DONATION_CLAIM) {
    return {
      title: `${donorName} says they donated`,
      body: `Please confirm at ${hospital}: Confirm Received or Did Not Happen.`,
    };
  }
  if (state === 'ARRIVED') {
    return { title: `${donorName} has arrived`, body: `Your donor is at ${hospital}.` };
  }
  if (state === 'EN_ROUTE') {
    return { title: `${donorName} is on the way`, body: `Your donor is en route to ${hospital}.` };
  }
  return { title: `${donorName} updated their status`, body: hospital };
}

// What the requester dashboard polls. Scoped to the requester's own requests
// (the JOIN on requests.requester_id), so nobody sees another requester's rows.
// A donation_claim card disappears by itself once the claim is resolved.
export async function getUnreadForRequester(requesterId, { limit = 10 } = {}) {
  const [rows] = await pool.query(
    `SELECT n.id, n.type, n.request_id, n.dedupe_key, n.created_at, r.hospital_name
       FROM notifications n
       JOIN requests r ON r.id = n.request_id AND r.requester_id = n.user_id
      WHERE n.user_id = ?
        AND n.type IN (?)
        AND n.read_at IS NULL
        AND n.created_at > NOW() - INTERVAL ${Number(FEED_WINDOW_HOURS)} HOUR
      ORDER BY n.id DESC
      LIMIT ?`,
    [requesterId, REQUESTER_NOTIFICATION_TYPES, Math.min(Math.max(Number(limit) || 10, 1), 25)]
  );
  if (rows.length === 0) return [];

  const parsed = rows.map((row) => {
    const [, , donorId, , state] = String(row.dedupe_key).split(':');
    return { row, donorId: Number(donorId), state };
  });

  const donorIds = [...new Set(parsed.map((p) => p.donorId))];
  const [nameRows] = await pool.query('SELECT id, name FROM users WHERE id IN (?)', [donorIds]);
  const names = new Map(nameRows.map((u) => [u.id, u.name]));

  const pairs = parsed.map((p) => [p.row.request_id, p.donorId]);
  const [respRows] = await pool.query(
    'SELECT request_id, donor_id, status FROM request_responses WHERE (request_id, donor_id) IN (?)',
    [pairs]
  );
  const respStatus = new Map(respRows.map((r) => [`${r.request_id}:${r.donor_id}`, r.status]));

  const out = [];
  for (const { row, donorId, state } of parsed) {
    if (row.type === NOTIFICATION_TYPE_DONATION_CLAIM && respStatus.get(`${row.request_id}:${donorId}`) !== 'claimed') {
      continue; // already confirmed / disputed: nothing left to ask
    }
    const content = describeRequesterNotification(row.type, state, names.get(donorId) || 'Your donor', row.hospital_name);
    out.push({
      id: row.id,
      type: row.type,
      request_id: row.request_id,
      donor_id: donorId,
      state,
      created_at: row.created_at,
      title: content.title,
      body: content.body,
      needs_action: row.type === NOTIFICATION_TYPE_DONATION_CLAIM,
    });
  }
  return out;
}
