import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { receiveEvidenceDocuments } from '../middleware/uploadDocuments.js';
import {
  submitRequestEvidence,
  getMyEvidenceSummaries,
  getEvidenceDocumentForViewer,
} from '../services/requestEvidence/requestEvidenceService.js';

const router = Router();

// Parses :requestId before any upload body is read.
function parseRequestId(req, res, next) {
  const id = Number(req.params.requestId);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid request id' });
  }
  req.requestId = id;
  next();
}

// GET /api/request-evidence/mine — the requester's evidence status for each of
// their own requests that has evidence: status, their files, and the admin's
// message when evidence was rejected or more information was asked for.
// Internal admin notes and reviewer identity are never included.
router.get('/mine', authenticate, authorize('requester'), async (req, res, next) => {
  try {
    res.json(await getMyEvidenceSummaries(req.user.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/request-evidence/documents/:key — streams one private document.
// The only way to read a file: there is no public URL. The requester who owns
// the request and admins are allowed; anyone else, or an unknown key, gets the
// same 404.
router.get('/documents/:key', authenticate, authorize('requester', 'admin'), async (req, res, next) => {
  try {
    const doc = await getEvidenceDocumentForViewer(req.params.key, req.user);
    const isPdf = doc.content_type === 'application/pdf';

    res.set({
      // The type detected from the file's signature when it was uploaded.
      'Content-Type': doc.content_type,
      'Content-Length': String(doc.data.length),
      // Images render inline; PDFs are downloaded rather than rendered in
      // the page context.
      'Content-Disposition': `${isPdf ? 'attachment' : 'inline'}; filename="${req.params.key}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    });
    res.send(doc.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/request-evidence/:requestId — multipart, field "documents"
// (1-3 files) plus an optional text field "note". Optional for requesters:
// requests are created, verified and accepted exactly as before without it.
// Also used to resubmit after a rejection or a request for more information.
router.post(
  '/:requestId',
  authenticate,
  authorize('requester'),
  parseRequestId,
  receiveEvidenceDocuments,
  async (req, res, next) => {
    try {
      const submission = await submitRequestEvidence(req.user.id, req.requestId, req.files, {
        note: req.body?.note,
      });
      res.status(201).json({ status: 'ok', submission });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
