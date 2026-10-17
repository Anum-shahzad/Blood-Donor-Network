import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../api/client.js';
import { ShieldCheckIcon, XIcon } from './icons.jsx';
import { formatDateTime, formatDate } from '../lib/format.js';
import { openPrivateDocument, formatFileSize } from '../lib/openPrivateDocument.js';

const TYPE_LABELS = {
  identity: 'Identity document',
  donation_evidence: 'Donation evidence',
};

const STATUS_BADGE = {
  pending: { className: 'badge-amber', label: 'Pending review' },
  approved: { className: 'badge-teal', label: 'Approved' },
  rejected: { className: 'badge-red', label: 'Rejected' },
  revoked: { className: 'badge-red', label: 'Revoked' },
};

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'all', label: 'All' },
];

const REASON_MIN = 5;
const REASON_MAX = 500;

// Admin review queue for identity documents and donation evidence. Decisions
// are made by the server; the level shown for each donor is derived there too.
export default function AdminVerificationPanel() {
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('all');
  const [data, setData] = useState({ submissions: [], counts: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [actingId, setActingId] = useState(null);
  const [openingKey, setOpeningKey] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'reject' | 'revoke', submission }
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status });
    if (type !== 'all') qs.set('type', type);
    return apiGet(`/api/admin/verification/submissions?${qs.toString()}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [status, type]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function approve(s) {
    setError('');
    setMessage('');
    setActingId(s.id);
    try {
      await apiPost(`/api/admin/verification/submissions/${s.id}/approve`);
      setMessage(`${TYPE_LABELS[s.type]} for ${s.user.name} approved.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActingId(null);
    }
  }

  function openModal(mode, submission) {
    setError('');
    setMessage('');
    setReason('');
    setModal({ mode, submission });
  }

  async function confirmModal() {
    if (!modal) return;
    const { mode, submission } = modal;
    setError('');
    setActingId(submission.id);
    try {
      await apiPost(`/api/admin/verification/submissions/${submission.id}/${mode}`, {
        reason: reason.trim(),
      });
      setMessage(
        mode === 'reject'
          ? `${TYPE_LABELS[submission.type]} for ${submission.user.name} rejected.`
          : `Approval of ${TYPE_LABELS[submission.type].toLowerCase()} for ${submission.user.name} revoked.`
      );
      setModal(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err.message);
      setModal(null);
    } finally {
      setActingId(null);
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

  const counts = data.counts;
  const countFor = (st) => {
    if (!counts) return null;
    const types = type === 'all' ? Object.keys(counts) : [type];
    return types.reduce((sum, t) => sum + (counts[t]?.[st] || 0), 0);
  };

  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX;

  return (
    <div className="tab-content stack" style={{ gap: '1.25rem' }}>
      <div className="form-card" style={{ padding: '1rem 1.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--ink)' }}>
          Check that each document plausibly belongs to the account holder. Approving an identity
          document confirms the account, and approving donation evidence records that a past donation is
          documented. Neither is a medical assessment, and neither shows that the donor is fit to donate.
        </p>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {message && (
        <div className="badge badge-teal" style={{ display: 'block', padding: '0.65rem 0.85rem', fontSize: '0.9rem' }}>
          {message}
        </div>
      )}

      <div className="form-card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTERS.map((f) => {
              const n = f.value === 'all' ? null : countFor(f.value);
              return (
                <option key={f.value} value={f.value}>
                  {f.label}
                  {n !== null ? ` (${n})` : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="identity">Identity document</option>
            <option value="donation_evidence">Donation evidence</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="empty-state">Loading submissions...</p>
      ) : data.submissions.length === 0 ? (
        <p className="empty-state">No submissions match this filter.</p>
      ) : (
        data.submissions.map((s) => {
          const badge = STATUS_BADGE[s.status];
          const busy = actingId === s.id;
          return (
            <div
              key={s.id}
              className={`record-card ${s.status === 'approved' ? 'state-verified' : s.status === 'pending' ? 'state-pending' : 'state-closed'}`}
            >
              <div className="record-title" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: '1rem', display: 'block' }}>
                    {s.user.name} &mdash; {TYPE_LABELS[s.type]}
                  </strong>
                  <span style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                    {s.user.email}
                    {s.user.city ? ` \u2022 ${s.user.city}` : ''}
                    {s.user.blood_group ? ` \u2022 ${s.user.blood_group}` : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className={`badge ${badge.className}`}>{badge.label}</span>
                  <span className="badge badge-neutral">
                    Level {s.user_level} &middot; {s.user_level_label}
                  </span>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--paper)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.65rem 0.85rem',
                  margin: '0.75rem 0',
                  fontSize: '0.82rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '0.5rem',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>SUBMITTED</span>
                  <span>{formatDateTime(s.submitted_at)}</span>
                </div>
                {s.type === 'donation_evidence' && (
                  <>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>DONATION DATE (DECLARED)</span>
                      <span>{formatDate(s.donation_date)}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>FACILITY (DECLARED)</span>
                      <span>{s.facility_name}</span>
                    </div>
                  </>
                )}
                {s.status === 'rejected' && (
                  <div>
                    <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>REJECTION REASON</span>
                    <span>{s.decision_reason}</span>
                  </div>
                )}
                {s.status === 'revoked' && (
                  <div>
                    <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' }}>
                      REVOKED {formatDateTime(s.revoked_at).toUpperCase()}
                    </span>
                    <span>{s.revocation_reason}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {s.files.map((f, i) => (
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

              {s.status === 'pending' && (
                <div className="record-actions">
                  <button
                    type="button"
                    onClick={() => approve(s)}
                    disabled={busy}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                  >
                    <ShieldCheckIcon size={14} /> {busy ? 'Working...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal('reject', s)}
                    disabled={busy}
                    className="btn btn-text"
                    style={{ fontSize: '0.82rem', color: 'var(--primary)', marginLeft: 'auto' }}
                  >
                    Reject with reason
                  </button>
                </div>
              )}
              {s.status === 'approved' && (
                <div className="record-actions">
                  <button
                    type="button"
                    onClick={() => openModal('revoke', s)}
                    disabled={busy}
                    className="btn btn-text"
                    style={{ fontSize: '0.82rem', color: 'var(--primary)', marginLeft: 'auto' }}
                  >
                    Revoke approval
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>{modal.mode === 'reject' ? 'Reject submission' : 'Revoke approval'}</h3>
              <button type="button" className="btn btn-text" onClick={() => setModal(null)} aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>

            <p style={{ marginTop: 0, fontSize: '0.88rem', color: 'var(--ink-muted)' }}>
              {TYPE_LABELS[modal.submission.type]} from {modal.submission.user.name}.{' '}
              {modal.mode === 'revoke' && modal.submission.type === 'identity'
                ? 'Revoking an identity approval also revokes this donor\u2019s approved donation evidence. '
                : ''}
              The donor will see your reason.
            </p>

            <label className="field">
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX}
                rows={4}
                style={{
                  fontFamily: 'var(--font-body)',
                  padding: '0.75rem 0.85rem',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  resize: 'vertical',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', fontWeight: 400 }}>
                {trimmedReason.length}/{REASON_MAX} (at least {REASON_MIN} characters)
              </span>
            </label>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmModal}
                disabled={!reasonValid || actingId === modal.submission.id}
              >
                {modal.mode === 'reject' ? 'Reject' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
