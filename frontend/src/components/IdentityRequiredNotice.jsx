import { ShieldCheckIcon } from './icons.jsx';

// Shown to a donor whose verification level (derived by the server from the
// database) is below 3. Accepting a request, holding a donation commitment and
// donating against a request all need an admin-approved identity (Level 3:
// Identity verified). The server enforces that rule on every endpoint; this
// notice only explains it and links to the existing Verification page.
export default function IdentityRequiredNotice({ level, onVerify }) {
  const pending = Number(level) === 2;
  return (
    <div
      className="form-card"
      role="status"
      style={{
        background: 'var(--amber-bg)',
        borderLeft: '4px solid var(--amber)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '1rem 1.25rem',
      }}
    >
      <div style={{ flex: '1 1 320px' }}>
        <h3 style={{ margin: '0 0 0.3rem', fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <ShieldCheckIcon size={18} /> Identity verification is required to accept requests
        </h3>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--ink-muted)', maxWidth: 'none' }}>
          {pending
            ? 'Your identity document is waiting for admin review (Level 2). You can accept requests and donate once an admin approves it (Level 3: Identity verified).'
            : 'You are at Level 1 (Registered). You can browse matching requests, but you cannot accept one or commit to donate until an admin approves your identity document (Level 3: Identity verified).'}
          {' '}Verification confirms who you are; it is not a medical check.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onVerify}>
        {pending ? 'View Verification Status' : 'Go to Verification'}
      </button>
    </div>
  );
}
