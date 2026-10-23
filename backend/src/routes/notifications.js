import { Router } from 'express';
import { createHash } from 'node:crypto';
import { pool } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { parseIdParam } from '../services/alertRules.js';
import { getUnreadForDonor, getUnreadForRequester, markRead, markAcknowledged } from '../services/notifications/notificationService.js';
import { validateSubscription } from '../services/notifications/pushEndpoints.js';
import { getPublicKey, isPushConfigured } from '../services/notifications/webPush.js';

const router = Router();

// Every query below is scoped to req.user.id, so nobody can read or change
// another user's notifications. Urgent alerts and push devices are donor-only;
// donor-progress / donation-claim notices are requester-only (see the
// /requester routes). The role check is per route.
router.use(authenticate);
const donorOnly = authorize('donor');
const requesterOnly = authorize('requester');

const MAX_SUBSCRIPTIONS_PER_USER = 5;
const hashEndpoint = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

// GET /api/notifications/requester/unread — donor progress and donation claims on the
// requester's own requests, polled by the requester dashboard
router.get('/requester/unread', requesterOnly, async (req, res, next) => {
  try {
    const notifications = await getUnreadForRequester(req.user.id);
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/requester/read   { ids: [1,2] } — dismissed
router.post('/requester/read', requesterOnly, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => parseIdParam(String(v))).filter(Boolean).slice(0, 50) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids is required' });
    const updated = await markRead(req.user.id, ids);
    res.json({ status: 'ok', updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread — polled by the dashboard
router.get('/unread', donorOnly, async (req, res, next) => {
  try {
    const notifications = await getUnreadForDonor(req.user.id);
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read   { ids: [1,2] } — dismissed
router.post('/read', donorOnly, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => parseIdParam(String(v))).filter(Boolean).slice(0, 50) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids is required' });
    const updated = await markRead(req.user.id, ids);
    res.json({ status: 'ok', updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/acknowledge — the donor opened or acted on it
router.post('/:id/acknowledge', donorOnly, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid notification id' });
    const updated = await markAcknowledged(req.user.id, id);
    if (updated === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/push/config — is Web Push available, and the PUBLIC key
router.get('/push/config', donorOnly, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    res.json({
      configured: isPushConfigured(),
      public_key: getPublicKey(),
      devices: Number(rows[0]?.n || 0),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/push/subscribe — save this browser's subscription
router.post('/push/subscribe', donorOnly, async (req, res, next) => {
  try {
    if (!isPushConfigured()) return res.status(503).json({ error: 'Web Push is not configured on the server' });
    const v = validateSubscription(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const userAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null;
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint),
         p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent), failure_count = 0`,
      [req.user.id, hashEndpoint(v.endpoint), v.endpoint, v.p256dh, v.auth, userAgent]
    );

    // Keep only the newest few devices per donor.
    await pool.query(
      `DELETE FROM push_subscriptions
        WHERE user_id = ? AND id NOT IN (
          SELECT id FROM (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_SUBSCRIPTIONS_PER_USER}) keep)`,
      [req.user.id, req.user.id]
    );

    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    res.status(201).json({ status: 'ok', devices: Number(rows[0]?.n || 0) });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/push/unsubscribe { endpoint } — remove THIS device only
router.post('/push/unsubscribe', donorOnly, async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 2048) {
      return res.status(400).json({ error: 'endpoint is required' });
    }
    const [r] = await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?',
      [req.user.id, hashEndpoint(endpoint)]
    );
    res.json({ status: 'ok', removed: r.affectedRows });
  } catch (err) {
    next(err);
  }
});

export default router;
