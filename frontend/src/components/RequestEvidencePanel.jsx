import { useState } from 'react';
import { apiUpload } from '../api/client.js';
import { CheckCircleIcon, ClockIcon, AlertCircleIcon, FileTextIcon } from './icons.jsx';
import { formatDateTime } from '../lib/format.js';
import { openPrivateDocument, formatFileSize } from '../lib/openPrivateDocument.js';

const STATUS_BADGE = {
  none: { className: 'badge-neutral', label: 'No evidence attached' },
  pending: { className: 'badge-amber', label: 'Under review' },
  approved: { className: 'badge-teal', label: 'Evidence approved' },
  rejected: { className: 'badge-red', label: 'Evidence rejected' },
  more_info: { className: 'badge-amber', label: 'More information needed' },
};

const LABEL_STYLE = { color: 'var(--ink-muted)', display: 'block', fontSize: '0.72rem' };

// Mirrors the server's limits; used until /api/request-evidence/mine has
// answered. The server's own limits are what is actually enforced.
export const DEFAULT_EVIDENCE_LIMITS = {
  max_file_bytes: 5 * 1024 * 1024,
  max_files: 3,
  allowed_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
};

// Client-side pre-check so an obviously bad file is caught before upload. The
// server re-validates everything (file signature, size, count).
export function checkEvidenceFiles(files, limits) {
  if (files.length === 0) return '';
  if (files.length > limits.max_files) return `Choose at most ${limits.max_files} files.`;
  const tooBig = files.find((f) => f.size > limits.max_file_bytes);
  if (tooBig) return `"${tooBig.name}" is larger than ${formatFileSize(limits.max_file_bytes)}.`;
  if (files.some((f) => f.size === 0)) return 'One of the files is empty.';
  return '';
}

// Evidence section of one request card, for the requester. Everything shown
// here comes from the server: the status, and the admin's message when
// evidence was rejected or more information was requested. Evidence is
// optional, and its review never changes the request's own verification.
export default function RequestEvidencePanel({ requestId, evidence, limits: limitsProp, onChanged }) {
  const limits = limitsProp || DEFAULT_EVIDENCE_LIMITS;
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [openingKey, setOpeningKey] = useState('');
  const [error, setError] = useState('');

  const status = evidence?.status || 'none';
  const badge = STATUS_BADGE[status];
  // Nothing submitted yet, or the last submission was turned down / needs more.
  const canSubmit = evidence ? evidence.can_submit : true;
  const acceptAttr = limits.allowed_types.join(',');

  async function submit() {
    setError('');
    const problem = checkEvidenceFiles(files, limits);
    if (problem || files.length === 0) {
      setError(problem || 'Choose at least one file.');
      return;
    }
    const form = new FormData();
    files.forEach((f) => form.append('documents', f));
    if (note.trim()) form.append('note', note.trim());

    setBusy(true);
    try {
      await apiUpload(`/api/request-evidence/${requestId}`, form);
      setFiles([]);
      setNote('');
      setInputKey((k) => k + 1);
      onChanged(`Evidence for request #${requestId} submitted. An admin will review it.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(key) {
    setError('');
    setOpeningKey(key);
    try {
      await openPrivateDocument(key, 'request-evidence');
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningKey('');
    }
  }

  return (
    <div
      style={{
        background: 'var(--paper)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.75rem 1rem',
        margin: '0 0 0.85rem',
        fontSize: '0.82rem',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ ...LABEL_STYLE, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <FileTextIcon size={12} /> HOSPITAL EVIDENCE (OPTIONAL)
        </span>
        <span className={`badge ${badge.className}`}>{badge.label}</span>
      </div>

      {status === 'none' && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-muted)' }}>
          Not required. Your request is reviewed with or without documents. If you have a hospital slip or letter,
          you can add it here.
        </p>
      )}

      {status === 'pending' && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--amber)' }}>
          <ClockIcon size={12} /> Submitted {formatDateTime(evidence.submitted_at)}. An admin will review it.
        </p>
      )}

      {status === 'approved' && (
        <p style={{ margin: '0.5rem 0 0', color: '#15803d' }}>
          <CheckCircleIcon size={12} /> An admin approved your evidence
          {evidence.reviewed_at ? ` on ${formatDateTime(evidence.reviewed_at)}` : ''}. Your request&apos;s own
          verification status is shown above.
        </p>
      )}

      {(status === 'rejected' || status === 'more_info') && (
        <div
          style={{
            margin: '0.6rem 0 0',
            padding: '0.6rem 0.8rem',
            borderRadius: 'var(--radius-sm)',
            borderLeft: `3px solid ${status === 'rejected' ? 'var(--primary)' : 'var(--amber)'}`,
            background: 'var(--surface)',
          }}
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <AlertCircleIcon size={13} />
            {status === 'rejected' ? 'The admin could not accept this evidence' : 'The admin needs more information'}
          </strong>
          {evidence.feedback && <p style={{ margin: '0.35rem 0 0' }}>{evidence.feedback}</p>}
          <p style={{ margin: '0.4rem 0 0', color: 'var(--ink-muted)' }}>
            Your request has not been cancelled by this. You can submit another document below, or keep waiting for
            verification.
          </p>
        </div>
      )}

      {evidence?.note && (
        <p style={{ margin: '0.6rem 0 0' }}>
          <span style={LABEL_STYLE}>YOUR NOTE</span>
          {evidence.note}
        </p>
      )}

      {evidence?.files?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
          {evidence.files.map((f, i) => (
            <button
              key={f.key}
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              onClick={() => openFile(f.key)}
              disabled={openingKey === f.key}
            >
              {openingKey === f.key ? 'Opening...' : `View file ${i + 1}`} ({formatFileSize(f.size_bytes)})
            </button>
          ))}
        </div>
      )}

      {error && <p className="error-banner" style={{ marginTop: '0.6rem' }}>{error}</p>}

      {canSubmit && (
        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          <label className="field" style={{ marginBottom: '0.5rem' }}>
            {evidence ? 'Submit another document' : 'Hospital slip, letter or other document'}
            <input
              key={`evidence-${requestId}-${inputKey}`}
              type="file"
              multiple
              accept={acceptAttr}
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <label className="field" style={{ marginBottom: '0.5rem' }}>
            Note for the admin (optional)
            <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
            Up to {limits.max_files} files &middot; JPEG, PNG, WebP or PDF &middot; {formatFileSize(limits.max_file_bytes)} each.
            Only you and the admin can open them.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
            disabled={busy || files.length === 0}
            onClick={submit}
          >
            {busy ? 'Uploading...' : 'Submit evidence'}
          </button>
        </div>
      )}
    </div>
  );
}
