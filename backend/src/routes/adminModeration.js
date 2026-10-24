import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  getReportCase,
  addReportNote,
  decideReport,
  reinstateUserStandalone,
} from '../services/moderation/moderationService.js';

const router = Router();

// Admin only. Investigation notes are returned by these routes and nowhere else.
router.use(authenticate, authorize('admin'));

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// GET /api/admin/moderation/reports/:id
// The full case file: report, reporter, reported user, request, user history,
// private notes, audit trail and decisions already made.
router.get('/reports/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid report id' });
    res.json(await getReportCase(id));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/moderation/reports/:id/notes   { note }
router.post('/reports/:id/notes', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid report id' });
    const saved = await addReportNote({ reportId: id, adminId: req.user.id, note: req.body?.note });
    res.status(201).json({ status: 'ok', ...saved });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/moderation/reports/:id/decision
//   { decision: 'dismiss' | 'warn' | 'suspend', reason, permanent?: true, duration_days?: 1-365 }
// For a warning or suspension, `reason` is shown to the affected user.
router.post('/reports/:id/decision', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid report id' });
    const { decision, reason, permanent, duration_days: durationDays } = req.body || {};
    const result = await decideReport({
      reportId: id, adminId: req.user.id, decision, reason, permanent: permanent === true, durationDays,
    });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/moderation/users/:id/reinstate   { reason }
router.post('/users/:id/reinstate', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id' });
    const result = await reinstateUserStandalone({ userId: id, adminId: req.user.id, reason: req.body?.reason });
    if (!result.changed) return res.status(409).json({ error: 'This account is not suspended' });
    res.json({ status: 'ok', is_suspended: false });
  } catch (err) {
    next(err);
  }
});

export default router;
