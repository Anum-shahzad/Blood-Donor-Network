import { useState } from 'react';
import { apiPost } from '../api/client.js';
import { ShieldCheckIcon, XIcon } from './icons.jsx';
import { formatDateTime } from '../lib/format.js';
import { openPrivateDocument, formatFileSize } from '../lib/openPrivateDocument.js';

const STATUS_BADGE = {
  none: { className: 'badge-neutral', label: 'Evidence: none provided' },
  pending: { className: 'badge-amber', label: 'Evidence: pending review' },
  approved: { className: 'badge-teal', label: 'Evidence: approved' },
  rejected: { className: 'badge-red', label: 'Evidence: rejected' },
  more_info: { className: 'badge-amber', label: 'Evidence: more info requested' },
};

const DECISION_LABELS = {
  approved: 'Approved',
  rejected: 'Rejected',
  more_info: 'More information requested',
};

const REASON_MIN = 5;
const REASON_MAX = 500;
const LABEL_STYLE = { color: 'var(--ink-muted)', display: 'block', fontSize: '0.7rem' };
const TEXTAREA_STYLE = {
  fontFamily: 'var(--font-body)',
  padding: '0.75rem 0.85rem',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  resize: 'vertical',
};

// Evidence section of one request card in the admin verification queue.
//
// This reviews the DOCUMENTS only. It never verifies or cancels the request:
// "Approve & Verify Request" and "Reject / Cancel" stay the only controls for
// that, and a request with no evidence is a normal request. The server makes
// every decision; this component only sends it.
export default function AdminRequestEvidence({ request, evidence, onDone, onError }) {
  const [modal, setModal] = useState(null); // 'reject' | 'request_info'
  const [reason, setReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingKey, setOpeningKey] = useState('');

  const status = evidence?.status || 'none';
  const badge = STATUS_BADGE[status];
  const live = ['pending', 'verified', 'matched', 'donor_accepted'].includes(request.status);
  const canReview = Boolean(evidence) && live;

  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX;

  async function send(decision, extra = {}) {
    setBusy(true);
    try {
      await apiPost(`/api/admin/request-evidence/submissions/${evidence.id}/review`, { decision, ...extra });
      const verb =
        decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'marked as needing more information';
      setModal(null);
      setReason('');
      setInternalNote('');
      onDone(`Evidence for request #${request.id} ${verb}.`);
    } catch (err) {
      setModal(null);
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openModal(mode) {
    setReason('');
    setInternalNote('');
    setModal(mode);
  }

  async function openFile(key) {
    setOpeningKey(key);
    try {
      await openPrivateDocument(key, 'request-evidence');
    } catch (err) {
      onError(err.message);
    } finally {
      setOpeningKey('');
    }
  }

  return (
    <div
      style={{
        background: 'var(--paper)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.65rem 0.85rem',
        margin: '0 0 0.75rem',
        fontSize: '0.82rem',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={LABEL_STYLE}>REQUEST EVIDENCE</span>
        <span className={`badge ${badge.className}`}>{badge.label}</span>
      </div>

      {!evidence && (
        <p style={{ margin: '0.45rem 0 0', color: 'var(--ink-muted)' }}>
          No documents are attached to this request (it was created before evidence became mandatory). Confirm with the
          hospital by phone and verify the request as usual.
        </p>
      )}

      {evidence && (
        <>
          <p style={{ margin: '0.45rem 0 0', color: 'var(--ink-muted)' }}>
            Submitted {formatDateTime(evidence.submitted_at)}
            {evidence.submission_count > 1 ? ` · submission ${evidence.submission_count}` : ''}. Reviewing evidence does
            not verify or cancel the request.
          </p>

          {evidence.note && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <span style={LABEL_STYLE}>REQUESTER NOTE</span>
              {evidence.note}
            </p>
          )}

          {evidence.files.length > 0 && (
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

          {(status === 'rejected' || status === 'more_info') && evidence.decision_reason && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <span style={LABEL_STYLE}>MESSAGE SHOWN TO REQUESTER</span>
              {evidence.decision_reason}
            </p>
          )}
          {evidence.internal_note && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <span style={LABEL_STYLE}>INTERNAL NOTE (ADMIN ONLY)</span>
              {evidence.internal_note}
            </p>
          )}

          {evidence.history.length > 0 && (
            <details style={{ marginTop: '0.6rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--ink-muted)' }}>
                Decision history ({evidence.history.length})
              </summary>
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                {evidence.history.map((h) => (
                  <li key={h.id} style={{ marginBottom: '0.3rem' }}>
                    <strong>{DECISION_LABELS[h.decision]}</strong> by {h.admin_name || 'a removed admin'} on{' '}
                    {formatDateTime(h.created_at)}
                    {h.reason ? ` — ${h.reason}` : ''}
                    {h.internal_note ? ` (internal: ${h.internal_note})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {canReview && (
            <div className="record-actions" style={{ marginTop: '0.75rem' }}>
              {status !== 'approved' && (
                <button
                  type="button"
                  onClick={() => send('approve')}
                  disabled={busy}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                >
                  <ShieldCheckIcon size={14} /> {busy ? 'Working...' : 'Approve evidence'}
                </button>
              )}
              {status !== 'more_info' && (
                <button
                  type="button"
                  onClick={() => openModal('request_info')}
                  disabled={busy}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                >
                  Request more information
                </button>
              )}
              {status !== 'rejected' && (
                <button
                  type="button"
                  onClick={() => openModal('reject')}
                  disabled={busy}
                  className="btn btn-text"
                  style={{ fontSize: '0.82rem', color: 'var(--primary)', marginLeft: 'auto' }}
                >
                  Reject evidence
                </button>
              )}
            </div>
          )}
        </>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>{modal === 'reject' ? 'Reject evidence' : 'Request more information'}</h3>
              <button type="button" className="btn btn-text" onClick={() => setModal(null)} aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>

            <p style={{ marginTop: 0, fontSize: '0.88rem', color: 'var(--ink-muted)' }}>
              Evidence for request #{request.id}. The requester will see your message. This does not cancel or
              un-verify the request.
            </p>

            <label className="field">
              {modal === 'reject' ? 'Reason (shown to requester)' : 'What do you need? (shown to requester)'}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX}
                rows={4}
                style={TEXTAREA_STYLE}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', fontWeight: 400 }}>
                {trimmedReason.length}/{REASON_MAX} (at least {REASON_MIN} characters)
              </span>
            </label>

            <label className="field">
              Internal note (admin only, optional)
              <textarea
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                maxLength={REASON_MAX}
                rows={2}
                style={TEXTAREA_STYLE}
              />
            </label>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!reasonValid || busy}
                onClick={() =>
                  send(modal, { reason: trimmedReason, internal_note: internalNote.trim() || undefined })
                }
              >
                {modal === 'reject' ? 'Reject evidence' : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
