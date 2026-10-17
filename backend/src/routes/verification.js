import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { receiveDocuments } from '../middleware/uploadDocuments.js';
import {
  getMyVerification,
  submitDocuments,
  getDocumentForViewer,
} from '../services/verification/verificationService.js';

const router = Router();

// GET /api/verification/me — the donor's derived level, latest submission of
// each type (with any rejection / revocation reason), and what they may submit.
router.get('/me', authenticate, authorize('donor'), async (req, res, next) => {
  try {
    res.json(await getMyVerification(req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/verification/identity — multipart, field "documents" (1-2 files).
// Optional for donors: nothing else in the app depends on it.
router.post('/identity', authenticate, authorize('donor'), receiveDocuments, async (req, res, next) => {
  try {
    const submission = await submitDocuments(req.user.id, 'identity', req.files);
    res.status(201).json({ status: 'ok', submission, verification: await getMyVerification(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/verification/donation-evidence — multipart, field "documents"
// plus text fields donation_date (YYYY-MM-DD) and facility_name. Requires an
// approved identity first.
router.post(
  '/donation-evidence',
  authenticate,
  authorize('donor'),
  receiveDocuments,
  async (req, res, next) => {
    try {
      const submission = await submitDocuments(req.user.id, 'donation_evidence', req.files, {
        donation_date: req.body?.donation_date,
        facility_name: req.body?.facility_name,
      });
      res.status(201).json({ status: 'ok', submission, verification: await getMyVerification(req.user.id) });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/verification/documents/:key — streams one private document.
// The only way to read a file: there is no public URL. The owner (donor) and
// admins are allowed; anyone else, or an unknown key, gets the same 404.
router.get('/documents/:key', authenticate, authorize('donor', 'admin'), async (req, res, next) => {
  try {
    const doc = await getDocumentForViewer(req.params.key, req.user);
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

export default router;
