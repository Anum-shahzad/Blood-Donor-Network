import { useEffect, useState } from 'react';
import { apiGet, apiUpload } from '../api/client.js';
import { CheckCircleIcon, ShieldCheckIcon, IdCardIcon, ClockIcon } from './icons.jsx';
import { formatDate, formatDateTime, todayForDateInput } from '../lib/format.js';
import { openPrivateDocument, formatFileSize } from '../lib/openPrivateDocument.js';

const STATUS_BADGE = {
  pending: { className: 'badge-amber', label: 'Pending review' },
  approved: { className: 'badge-teal', label: 'Approved' },
  rejected: { className: 'badge-red', label: 'Rejected' },
  revoked: { className: 'badge-red', label: 'Revoked' },
};

function StatusBadge({ status }) {
  const meta = STATUS_BADGE[status];
  if (!meta) return null;
  return <span className={`badge ${meta.className}`}>{meta.label}</span>;
}

function FileLinks({ files, onOpen, openingKey }) {
  if (!files || files.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
      {files.map((f, i) => (
        <button
          key={f.key}
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
          onClick={() => onOpen(f.key)}
          disabled={openingKey === f.key}
        >
          {openingKey === f.key ? 'Opening...' : `View file ${i + 1}`} ({formatFileSize(f.size_bytes)})
        </button>
      ))}
    </div>
  );
}

// Donor-facing verification screen. The level shown is whatever the server
// derived from the database; nothing on this screen can set it.
export default function VerificationPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState('');
  const [openingKey, setOpeningKey] = useState('');

  const [identityFiles, setIdentityFiles] = useState([]);
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [evidenceDate, setEvidenceDate] = useState('');
  const [evidenceFacility, setEvidenceFacility] = useState('');
  // Changing the key remounts a file input, which is the only way to clear it.
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    apiGet('/api/verification/me')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function checkFiles(files) {
    const limits = data.limits;
    if (files.length === 0) return 'Choose at least one file.';
    if (files.length > limits.max_files) return `Choose at most ${limits.max_files} files.`;
    const tooBig = files.find((f) => f.size > limits.max_file_bytes);
    if (tooBig) return `"${tooBig.name}" is larger than ${formatFileSize(limits.max_file_bytes)}.`;
    if (files.some((f) => f.size === 0)) return 'One of the files is empty.';
    return '';
  }

  async function submit(kind) {
    setError('');
    setMessage('');
    const isIdentity = kind === 'identity';
    const files = isIdentity ? identityFiles : evidenceFiles;

    const problem = checkFiles(files);
    if (problem) {
      setError(problem);
      return;
    }
    if (!isIdentity && (!evidenceDate || evidenceFacility.trim().length < 2)) {
      setError('Enter the donation date and the hospital or blood bank name.');
      return;
    }

    const form = new FormData();
    files.forEach((f) => form.append('documents', f));
    if (!isIdentity) {
      form.append('donation_date', evidenceDate);
      form.append('facility_name', evidenceFacility.trim());
    }

    setSubmitting(kind);
    try {
      const res = await apiUpload(
        isIdentity ? '/api/verification/identity' : '/api/verification/donation-evidence',
        form
      );
      setData(res.verification);
      setMessage(
        isIdentity
          ? 'Identity document submitted. An admin will review it.'
          : 'Donation evidence submitted. An admin will review it.'
      );
      setIdentityFiles([]);
      setEvidenceFiles([]);
      setEvidenceDate('');
      setEvidenceFacility('');
      setInputKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting('');
    }
  }

  async function openFile(key) {
    setError('');
    setOpeningKey(key);
    try {
      await openPrivateDocument(key);
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningKey('');
    }
  }

  if (loading) return <p className="empty-state">Loading verification status...</p>;
  if (!data) return error ? <p className="error-banner">{error}</p> : null;

  const { identity, donation_evidence: evidence, can_submit: canSubmit, limits } = data;
  const acceptAttr = limits.allowed_types.join(',');
  const identityApproved = identity?.status === 'approved';

  return (
    <div className="tab-content stack" style={{ gap: '1.5rem' }}>
      {error && <p className="error-banner">{error}</p>}
      {message && (
        <div className="badge badge-teal" style={{ display: 'block', padding: '0.65rem 0.85rem', fontSize: '0.9rem' }}>
          {message}
        </div>
      )}

      {/* Level summary */}
      <div className="form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <ShieldCheckIcon size={20} /> Verification level {data.level} of 5
          </h3>
          <span className={`badge ${data.level >= 3 ? 'badge-teal' : 'badge-neutral'}`}>{data.level_label}</span>
        </div>
        <p style={{ margin: '0.6rem 0 1rem', fontSize: '0.88rem', color: 'var(--ink-muted)' }}>
          {data.level_description}
        </p>

        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.45rem' }}>
          {data.levels.map((l) => {
            const done = data.level >= l.level;
            const current = data.level === l.level;
            return (
              <li
                key={l.level}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${current ? 'var(--primary)' : 'var(--border)'}`,
                  background: 'var(--paper)',
                  opacity: done || current ? 1 : 0.7,
                }}
              >
                <span style={{ color: done ? 'var(--success)' : 'var(--ink-muted)', display: 'flex', marginTop: 2 }}>
                  {done ? <CheckCircleIcon size={16} /> : <ClockIcon size={16} />}
                </span>
                <span style={{ fontSize: '0.85rem' }}>
                  <strong>Level {l.level}: {l.label}</strong>
                  <span style={{ display: 'block', color: 'var(--ink-muted)', fontSize: '0.78rem' }}>{l.description}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="form-card" style={{ padding: '1rem 1.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink)' }}>
          <strong>What verification means.</strong> {data.notice}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
        {/* Identity */}
        <div className="form-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <IdCardIcon size={18} /> Identity verification
            </h3>
            {identity && <StatusBadge status={identity.status} />}
          </div>

          <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
            Required to accept blood requests and donate (Level 3). Submitting a photo ID lets an admin confirm the account is yours.
            Only you and the admin can open your documents.
          </p>

          {identity && (
            <div style={{ fontSize: '0.84rem', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--ink-muted)' }}>Submitted {formatDateTime(identity.submitted_at)}</span>
              {identity.status === 'rejected' && (
                <p style={{ margin: '0.4rem 0 0' }}>
                  <strong>Reason:</strong> {identity.decision_reason}
                </p>
              )}
              {identity.status === 'revoked' && (
                <p style={{ margin: '0.4rem 0 0' }}>
                  <strong>Approval withdrawn:</strong> {identity.revocation_reason}
                </p>
              )}
              <FileLinks files={identity.files} onOpen={openFile} openingKey={openingKey} />
            </div>
          )}

          {canSubmit.identity && (
            <div>
              <label className="field" style={{ marginBottom: '0.6rem' }}>
                {identity ? 'Submit a new document' : 'Photo ID (front, and back if it has one)'}
                <input
                  key={`id-${inputKey}`}
                  type="file"
                  multiple
                  accept={acceptAttr}
                  onChange={(e) => setIdentityFiles(Array.from(e.target.files || []))}
                />
              </label>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                Up to {limits.max_files} files &middot; JPEG, PNG, WebP or PDF &middot; {formatFileSize(limits.max_file_bytes)} each
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting !== '' || identityFiles.length === 0}
                onClick={() => submit('identity')}
              >
                {submitting === 'identity' ? 'Uploading...' : 'Submit for review'}
              </button>
            </div>
          )}
        </div>

        {/* Donation evidence */}
        <div className="form-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ShieldCheckIcon size={18} /> Donation evidence
            </h3>
            {evidence && <StatusBadge status={evidence.status} />}
          </div>

          <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
            Optional, and not needed to donate. A donation card or certificate from a hospital or blood bank documents a previous donation.
            It is a record of that donation only, not a statement about your current health.
          </p>

          {!identityApproved && !evidence && (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
              Available once your identity has been approved.
            </p>
          )}

          {evidence && (
            <div style={{ fontSize: '0.84rem', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--ink-muted)' }}>
                {evidence.facility_name} &middot; donated {formatDate(evidence.donation_date)} &middot; submitted {formatDateTime(evidence.submitted_at)}
              </span>
              {evidence.status === 'rejected' && (
                <p style={{ margin: '0.4rem 0 0' }}>
                  <strong>Reason:</strong> {evidence.decision_reason}
                </p>
              )}
              {evidence.status === 'revoked' && (
                <p style={{ margin: '0.4rem 0 0' }}>
                  <strong>Approval withdrawn:</strong> {evidence.revocation_reason}
                </p>
              )}
              <FileLinks files={evidence.files} onOpen={openFile} openingKey={openingKey} />
            </div>
          )}

          {canSubmit.donation_evidence && (
            <div>
              <label className="field" style={{ marginBottom: '0.6rem' }}>
                Date of the donation
                <input
                  type="date"
                  value={evidenceDate}
                  max={todayForDateInput()}
                  onChange={(e) => setEvidenceDate(e.target.value)}
                />
              </label>
              <label className="field" style={{ marginBottom: '0.6rem' }}>
                Hospital or blood bank
                <input
                  type="text"
                  value={evidenceFacility}
                  maxLength={190}
                  onChange={(e) => setEvidenceFacility(e.target.value)}
                />
              </label>
              <label className="field" style={{ marginBottom: '0.6rem' }}>
                Donation card or certificate
                <input
                  key={`ev-${inputKey}`}
                  type="file"
                  multiple
                  accept={acceptAttr}
                  onChange={(e) => setEvidenceFiles(Array.from(e.target.files || []))}
                />
              </label>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                Up to {limits.max_files} files &middot; JPEG, PNG, WebP or PDF &middot; {formatFileSize(limits.max_file_bytes)} each
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting !== '' || evidenceFiles.length === 0}
                onClick={() => submit('donation_evidence')}
              >
                {submitting === 'donation_evidence' ? 'Uploading...' : 'Submit for review'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
