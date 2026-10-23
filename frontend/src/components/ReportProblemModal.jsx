import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.js';
import { XIcon, AlertCircleIcon } from './icons.jsx';

// "Report a Problem" about a donation / request. Used by both dashboards.
// The report is saved on the server (fraud_reports) and shows up in the admin
// Fraud Reports queue; this component only collects the reason and details.
//   role 'requester' -> POST /api/requests/:requestId/report-problem  { donor_id }
//   role 'donor'     -> POST /api/donors/me/report-problem            { request_id }
export default function ReportProblemModal({ role, requestId, donorId, subject, onClose, onDone }) {
  const [reasons, setReasons] = useState(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const path = role === 'requester' ? '/api/requests/report-reasons' : '/api/donors/report-reasons';
    apiGet(path)
      .then((data) => {
        setReasons(data.reasons || {});
        setReason(Object.keys(data.reasons || {})[0] || '');
      })
      .catch((err) => setError(err.message));
  }, [role]);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (role === 'requester') {
        await apiPost(`/api/requests/${requestId}/report-problem`, { donor_id: donorId, reason, details });
      } else {
        await apiPost('/api/donors/me/report-problem', { request_id: requestId, reason, details });
      }
      onDone('Your report was sent to the administrators for review.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><AlertCircleIcon size={20} /> Report a Problem</h3>
          <button type="button" onClick={onClose} className="btn-text" aria-label="Close" style={{ color: 'var(--ink-muted)' }}>
            <XIcon size={18} />
          </button>
        </div>

        {subject && (
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginBottom: '1rem' }}>{subject}</p>
        )}
        {error && <p className="error-banner">{error}</p>}

        <form onSubmit={submit} className="stack" style={{ gap: '1rem' }}>
          <label className="field">
            What went wrong?
            <select value={reason} onChange={(e) => setReason(e.target.value)} required disabled={!reasons}>
              {Object.entries(reasons || {}).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Details (optional unless you chose &quot;Something else&quot;)
            <textarea
              rows={4}
              maxLength={1500}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What happened, and when?"
            />
          </label>
          <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', margin: 0 }}>
            An administrator will review this. Reporting does not change whether a donation is counted.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" disabled={submitting || !reason} className="btn btn-primary" style={{ flex: 1 }}>
              {submitting ? 'Sending...' : 'Send Report'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
