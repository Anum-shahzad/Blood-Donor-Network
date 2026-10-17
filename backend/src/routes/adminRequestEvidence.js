import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  listEvidenceForAdmin,
  reviewEvidence,
} from '../services/requestEvidence/requestEvidenceService.js';

const router = Router();

// Admin only. Documents themselves are streamed by
// GET /api/request-evidence/documents/:key, which also allows admins.
router.use(authenticate, authorize('admin'));

// GET /api/admin/request-evidence — latest evidence submission for every
// request that has one (files, requester note, current decision, decision
// trail) plus counts by status. Merge into the request list by request_id.
router.get('/', async (req, res, next) => {
  try {
    res.json(await listEvidenceForAdmin());
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/request-evidence/submissions/:id/review
//   { decision: 'approve' | 'reject' | 'request_info', reason?, internal_note? }
// reject and request_info require a reason (shown to the requester).
// This only records an evidence decision: it never verifies, un-verifies,
// cancels or otherwise changes the request itself.
router.post('/submissions/:id/review', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }
    const body = req.body || {};
    const result = await reviewEvidence(id, req.user.id, {
      decision: body.decision,
      reason: body.reason,
      internal_note: body.internal_note,
    });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
