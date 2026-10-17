// Receives multipart uploads for verification documents.
//
// Files are held in memory only long enough to be validated (signature check)
// and written to private storage. Nothing is ever written to the local disk,
// which is ephemeral/read-only on the hosts this project deploys to.
//
// Run this AFTER authenticate/authorize so anonymous callers never get their
// bodies parsed.
import multer from 'multer';
import { MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION } from '../services/verification/verificationRules.js';

export const DOCUMENT_FIELD = 'documents';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES_PER_SUBMISSION,
    fields: 6,
    fieldSize: 2 * 1024,
    parts: MAX_FILES_PER_SUBMISSION + 6,
  },
}).array(DOCUMENT_FIELD, MAX_FILES_PER_SUBMISSION);

function uploadError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function receiveDocuments(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(uploadError(413, 'Each file must be 5 MB or smaller'));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(uploadError(400, `Attach at most ${MAX_FILES_PER_SUBMISSION} files`));
      }
      return next(uploadError(400, 'The upload could not be read'));
    }
    // Malformed multipart bodies surface as plain errors from the parser.
    return next(uploadError(400, 'The upload could not be read'));
  });
}
