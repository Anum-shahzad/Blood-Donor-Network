import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  listSubmissionsForAdmin,
  approveSubmission,
  rejectSubmission,
  revokeSubmission,
} from '../services/verification/verificationService.js';

const router = Router();

// Admin only. Documents themselves are streamed by
// GET /api/verification/documents/:key, which also allows admins.
router.use(authenticate, authorize('admin'));

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid submission id' });
    return null;
  }
  return id;
}

// GET /api/admin/verification/submissions?status=pending|approved|rejected|revoked|all&type=identity|donation_evidence
// Default is the pending queue, oldest first. Each entry carries the donor's
// name, email, city and blood group (no phone number), the file list, and the
// donor's current derived level.
router.get('/submissions', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;
    res.json(await listSubmissionsForAdmin({ status, type }));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/verification/submissions/:id/approve
router.post('/submissions/:id/approve', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    res.json({ status: 'ok', ...(await approveSubmission(id, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/verification/submissions/:id/reject   { reason }
router.post('/submissions/:id/reject', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    res.json({ status: 'ok', ...(await rejectSubmission(id, req.user.id, req.body?.reason)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/verification/submissions/:id/revoke   { reason }
router.post('/submissions/:id/revoke', async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    res.json({ status: 'ok', ...(await revokeSubmission(id, req.user.id, req.body?.reason)) });
  } catch (err) {
    next(err);
  }
});

export default router;
