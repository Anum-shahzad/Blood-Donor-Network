// Receives multipart uploads for private documents (identity / donation
// verification in Phase 1, request evidence in Phase 2).
//
// Files are held in memory only long enough to be validated (signature check)
// and written to private storage. Nothing is ever written to the local disk,
// which is ephemeral/read-only on the hosts this project deploys to.
//
// Run this AFTER authenticate/authorize so anonymous callers never get their
// bodies parsed.
import multer from 'multer';
import { MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION } from '../services/verification/verificationRules.js';
import { MAX_EVIDENCE_FILES } from '../services/requestEvidence/requestEvidenceRules.js';

export const DOCUMENT_FIELD = 'documents';

function uploadError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// One multer instance per file-count ceiling. Every limit except the file
// count (5 MB per file, small text fields, in-memory storage) is shared.
function buildReceiver(maxFiles) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: maxFiles,
      fields: 6,
      fieldSize: 2 * 1024,
      parts: maxFiles + 6,
    },
  }).array(DOCUMENT_FIELD, maxFiles);

  return function receive(req, res, next) {
    upload(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(uploadError(413, 'Each file must be 5 MB or smaller'));
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(uploadError(400, `Attach at most ${maxFiles} files`));
        }
        return next(uploadError(400, 'The upload could not be read'));
      }
      // Malformed multipart bodies surface as plain errors from the parser.
      return next(uploadError(400, 'The upload could not be read'));
    });
  };
}

// Identity / donation evidence (Phase 1).
export const receiveDocuments = buildReceiver(MAX_FILES_PER_SUBMISSION);

// Optional request evidence (Phase 2).
export const receiveEvidenceDocuments = buildReceiver(MAX_EVIDENCE_FILES);
