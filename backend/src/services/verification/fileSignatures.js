// Identifies an uploaded file by its CONTENT (magic bytes), never by its
// extension or the Content-Type header the client claims. Anything that is not
// one of the types below is rejected.
//
// Allowed: JPEG, PNG, WebP, PDF.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Smallest buffer any of the checks below can safely inspect.
const MIN_BYTES = 12;

// Returns { mime, ext } for a recognised file, or null.
export function detectFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_BYTES) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mime: 'image/png', ext: 'png' };
  }

  // WebP: "RIFF" <4-byte size> "WEBP"
  if (
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // PDF: "%PDF-" at the very start of the file
  if (buffer.toString('latin1', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  return null;
}

export const ALLOWED_TYPES_LABEL = 'JPEG, PNG, WebP or PDF';
