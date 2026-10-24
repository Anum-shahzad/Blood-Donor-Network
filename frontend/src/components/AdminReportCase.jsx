import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch } from '../api/client.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import { confirmDialog } from './ConfirmDialog.jsx';

const box = { border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 0.9rem' };
const small = { fontSize: '0.8rem', color: 'var(--ink-muted)' };
const textarea = {
  width: '100%', minHeight: '4.5rem', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-strong)', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box',
};
const sectionTitle = { margin: '0 0 0.5rem', fontSize: '0.95rem' };

function untilText(user) {
  if (!user.suspension_active) return '';
  return user.suspended_until ? `until ${formatDateTime(user.suspended_until)}` : 'permanently';
}

// Opens one report: everything the admin needs to review it, private notes,
// status, and the decision (dismiss, warn, suspend). All state lives on the
// server; this component only displays it and sends the admin's actions.
export default function AdminReportCase({ reportId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [note, setNote] = useState('');
  const [statusChoice, setStatusChoice] = useState('investigating');
  const [decision, setDecision] = useState('dismiss');
  const [reason, setReason] = useState('');
  const [suspendKind, setSuspendKind] = useState('temporary');
  const [days, setDays] = useState(7);
  const [reinstateReason, setReinstateReason] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet(`/api/admin/moderation/reports/${reportId}`));
    } catch (err) {
      setError(err.message);
    }
  }, [reportId]);

  useEffect(() => { setData(null); setError(''); setMsg(''); load(); }, [load]);

  async function run(fn, okMessage) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(okMessage);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const addNote = () => run(async () => {
    await apiPost(`/api/admin/moderation/reports/${reportId}/notes`, { note });
    setNote('');
  }, 'Private note saved.');

  const updateStatus = () => run(
    () => apiPatch(`/api/admin/fraud-reports/${reportId}`, { status: statusChoice }),
    `Status changed to ${statusChoice}.`
  );

  async function submitDecision() {
    const target = data?.target_user?.name || 'the reported user';
    const label = decision === 'dismiss'
      ? 'Dismiss this report? The reporter will be told it was reviewed.'
      : decision === 'warn'
        ? `Send a warning to ${target}? They will see your reason.`
        : `Suspend ${target} ${suspendKind === 'permanent' ? 'permanently' : `for ${days} day(s)`}? They will be blocked immediately and will see your reason.`;
    const ok = await confirmDialog({
      title: decision === 'dismiss' ? 'Dismiss report?' : decision === 'warn' ? 'Send warning?' : 'Suspend user?',
      message: label,
      confirmLabel: decision === 'dismiss' ? 'Dismiss' : decision === 'warn' ? 'Send warning' : 'Suspend',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    const body = { decision, reason };
    if (decision === 'suspend') {
      if (suspendKind === 'permanent') body.permanent = true;
      else body.duration_days = Number(days);
    }
    run(async () => {
      await apiPost(`/api/admin/moderation/reports/${reportId}/decision`, body);
      setReason('');
    }, 'Decision saved and the affected users were notified.');
  }

  async function lift() {
    const ok = await confirmDialog({
      title: 'Lift suspension?',
      message: `Lift the suspension on ${data.target_user.name}? They will be notified.`,
      confirmLabel: 'Lift suspension',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    run(async () => {
      await apiPost(`/api/admin/moderation/users/${data.target_user.id}/reinstate`, { reason: reinstateReason });
      setReinstateReason('');
    }, 'Suspension lifted and the user was notified.');
  }

  if (!data) {
    return (
      <div className="form-card">
        {error ? <p className="error-banner">{error}</p> : <p style={small}>Loading report...</p>}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    );
  }

  const { report, target_user: user, request, donor_response: resp, history, notes, events, decisions, reporter_stats: rs } = data;
  const open = report.status === 'pending' || report.status === 'investigating';
  const canActOnUser = Boolean(user) && user.role !== 'admin';

  return (
    <div className="form-card" style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
          Report #{report.id}{' '}
          <span className="badge badge-amber">{report.report_type}</span>{' '}
          <span className="badge badge-neutral">{report.status}</span>
        </h3>
        <button className="btn btn-secondary" onClick={onClose}>Close case</button>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {msg && <div className="badge badge-teal" style={{ display: 'block', padding: '0.6rem 0.85rem' }}>{msg}</div>}

      {/* Report */}
      <div style={box}>
        <h4 style={sectionTitle}>Report</h4>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>{report.details}</div>
        <div style={{ ...small, marginTop: '0.4rem' }}>
          Filed {formatDateTime(report.created_at)}
          {report.reporter_name ? ` by ${report.reporter_name} (${report.reporter_role}, ${report.reporter_email})` : ' by the system'}
          {rs ? ` | Reporter has filed ${rs.total} report(s), ${rs.dismissed} dismissed` : ''}
          {report.reviewed_at ? ` | Last reviewed ${formatDateTime(report.reviewed_at)}${report.reviewed_by_name ? ` by ${report.reviewed_by_name}` : ''}` : ''}
        </div>
      </div>

      {/* Request and donor response */}
      {(request || resp) && (
        <div style={box}>
          <h4 style={sectionTitle}>Request</h4>
          {request && (
            <div style={{ fontSize: '0.88rem' }}>
              Request #{request.id}: {request.blood_group}, {request.units_needed} unit(s) at {request.hospital_name}, {request.city}
              {' | '}urgency {request.urgency} | status {request.status}{request.is_verified ? ' (verified)' : ' (unverified)'}
              {' | '}requester {request.requester_name} | posted {formatDate(request.created_at)}
            </div>
          )}
          {resp && (
            <div style={{ ...small, marginTop: '0.3rem' }}>
              Donor {resp.donor_name}: response {resp.status}
              {resp.claimed_at ? ` | claimed ${formatDate(resp.claimed_at)}${resp.claim_units ? ` (${resp.claim_units} unit)` : ''}` : ''}
              {resp.status === 'donated' ? ' | confirmed by the requester' : resp.claimed_at ? ' | not counted as a donation' : ''}
            </div>
          )}
        </div>
      )}

      {/* Reported user and history */}
      <div style={box}>
        <h4 style={sectionTitle}>Reported user</h4>
        {!user ? (
          <p style={small}>This report is not linked to a user account, so a warning or suspension is not possible. It can still be dismissed or resolved.</p>
        ) : (
          <>
            <div style={{ fontSize: '0.88rem' }}>
              <strong>{user.name}</strong> ({user.role}) | {user.email}{user.phone ? ` | ${user.phone}` : ''}{user.city ? ` | ${user.city}` : ''} | joined {formatDate(user.created_at)}
            </div>
            <div style={{ marginTop: '0.3rem' }}>
              {user.suspension_active ? (
                <span className="badge badge-red">Suspended {untilText(user)}</span>
              ) : (
                <span className="badge badge-teal">Active</span>
              )}
              {user.suspension_active && user.suspension_reason && (
                <span style={{ ...small, marginLeft: '0.5rem' }}>Reason: {user.suspension_reason}</span>
              )}
            </div>
            {history && (
              <div style={{ ...small, marginTop: '0.5rem' }}>
                Other reports against this user: {history.other_reports_total} | Warnings: {history.warnings} | Suspensions: {history.suspensions}
                {history.donations_total != null ? ` | Confirmed donations: ${history.donations_total}` : ''}
                {history.response_counts ? ` | Responses: ${Object.entries(history.response_counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}` : ''}
              </div>
            )}
            {history?.other_reports?.length > 0 && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Other reports against this user</summary>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                  {history.other_reports.map((r) => (
                    <li key={r.id}>#{r.id} {r.report_type} ({r.status}), {formatDate(r.created_at)}: {r.details}</li>
                  ))}
                </ul>
              </details>
            )}
            {history?.moderation?.length > 0 && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>Moderation history</summary>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                  {history.moderation.map((m) => (
                    <li key={m.id}>
                      {formatDateTime(m.created_at)} | {m.action}
                      {m.action === 'suspension' ? (m.is_permanent ? ' (permanent)' : ` (until ${formatDateTime(m.suspended_until)})`) : ''}
                      {m.admin_name ? ` by ${m.admin_name}` : ''}: {m.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {history?.requests?.length > 0 && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                  {user.role === 'donor' ? 'Recent request responses' : 'Recent requests'}
                </summary>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                  {history.requests.map((r) => (
                    user.role === 'donor' ? (
                      <li key={r.request_id}>Request #{r.request_id} at {r.hospital_name} ({r.blood_group}): response {r.status}, request {r.request_status}</li>
                    ) : (
                      <li key={r.id}>#{r.id} {r.blood_group}, {r.units_needed} unit(s) at {r.hospital_name}, {formatDate(r.created_at)}: {r.status}</li>
                    )
                  ))}
                </ul>
              </details>
            )}
            {user.suspension_active && (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.4rem' }}>
                <label style={small} htmlFor="reinstate-reason">Reason for lifting the suspension (shown to the user, 10+ characters)</label>
                <textarea id="reinstate-reason" style={textarea} value={reinstateReason} onChange={(e) => setReinstateReason(e.target.value)} />
                <div>
                  <button className="btn btn-secondary" disabled={busy || reinstateReason.trim().length < 10} onClick={lift}>Lift suspension</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Private notes */}
      <div style={box}>
        <h4 style={sectionTitle}>Private investigation notes</h4>
        <p style={{ ...small, margin: '0 0 0.5rem' }}>Only administrators can see these. They are never shown to users and never included in notifications.</p>
        {notes.length === 0 ? (
          <p style={small}>No notes yet.</p>
        ) : (
          <ul style={{ margin: '0 0 0.6rem', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
            {notes.map((n) => (
              <li key={n.id} style={{ whiteSpace: 'pre-wrap' }}>
                <span style={small}>{formatDateTime(n.created_at)}{n.admin_name ? ` | ${n.admin_name}` : ''}</span>
                <br />{n.note}
              </li>
            ))}
          </ul>
        )}
        <textarea style={textarea} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private note" maxLength={2000} />
        <div style={{ marginTop: '0.4rem' }}>
          <button className="btn btn-secondary" disabled={busy || !note.trim()} onClick={addNote}>Add private note</button>
        </div>
      </div>

      {/* Status + decision */}
      {open ? (
        <>
          <div style={box}>
            <h4 style={sectionTitle}>Status</h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={statusChoice} onChange={(e) => setStatusChoice(e.target.value)} style={{ padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)' }}>
                <option value="pending">Pending</option>
                <option value="investigating">Investigating</option>
              </select>
              <button className="btn btn-secondary" disabled={busy || statusChoice === report.status} onClick={updateStatus}>Update status</button>
              <span style={small}>Closing the report is done with a decision below.</span>
            </div>
          </div>

          <div style={box}>
            <h4 style={sectionTitle}>Decision</h4>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.6rem', fontSize: '0.88rem' }}>
              {[['dismiss', 'Dismiss report'], ['warn', 'Issue warning'], ['suspend', 'Suspend account']].map(([value, label]) => (
                <label key={value} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', opacity: value !== 'dismiss' && !canActOnUser ? 0.5 : 1 }}>
                  <input type="radio" name="decision" value={value} checked={decision === value} disabled={value !== 'dismiss' && !canActOnUser} onChange={() => setDecision(value)} />
                  {label}
                </label>
              ))}
            </div>
            {decision === 'suspend' && (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem', fontSize: '0.88rem' }}>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input type="radio" name="suspendKind" checked={suspendKind === 'temporary'} onChange={() => setSuspendKind('temporary')} />
                  Temporary
                </label>
                <input type="number" min={1} max={365} value={days} disabled={suspendKind !== 'temporary'} onChange={(e) => setDays(e.target.value)} style={{ width: '5rem', padding: '0.4rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)' }} />
                <span style={small}>days (1 to 365)</span>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input type="radio" name="suspendKind" checked={suspendKind === 'permanent'} onChange={() => setSuspendKind('permanent')} />
                  Permanent
                </label>
              </div>
            )}
            <label style={small} htmlFor="decision-reason">
              {decision === 'dismiss' ? 'Reason (internal, not shown to users, 10+ characters)' : 'Reason (shown to the affected user, 10+ characters)'}
            </label>
            <textarea id="decision-reason" style={textarea} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <div style={{ marginTop: '0.4rem' }}>
              <button className="btn btn-primary" disabled={busy || reason.trim().length < 10} onClick={submitDecision}>
                {decision === 'dismiss' ? 'Dismiss report' : decision === 'warn' ? 'Send warning' : 'Apply suspension'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div style={box}>
          <p style={{ ...small, margin: 0 }}>This report is {report.status}. Decisions can only be made on open reports.</p>
        </div>
      )}

      {/* Decisions and audit trail */}
      <div style={box}>
        <h4 style={sectionTitle}>Decisions and audit trail</h4>
        {decisions.length > 0 && (
          <ul style={{ margin: '0 0 0.6rem', paddingLeft: '1.1rem', fontSize: '0.82rem' }}>
            {decisions.map((d) => (
              <li key={d.id}>
                {formatDateTime(d.created_at)} | {d.action}
                {d.action === 'suspension' ? (d.is_permanent ? ' (permanent)' : ` (until ${formatDateTime(d.suspended_until)})`) : ''}
                {d.admin_name ? ` by ${d.admin_name}` : ''}: {d.reason}
              </li>
            ))}
          </ul>
        )}
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
          {events.map((e) => (
            <li key={e.id}>
              {formatDateTime(e.created_at)} | {e.action.replace(/_/g, ' ')}
              {e.from_status || e.to_status ? ` (${e.from_status || 'new'} to ${e.to_status})` : ''}
              {e.actor_name ? ` by ${e.actor_name}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
