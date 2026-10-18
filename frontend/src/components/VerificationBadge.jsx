import { ShieldCheckIcon } from './icons.jsx';

// One place that turns the server's derived `verification` object into a badge,
// so donor cards, the donor pass and the admin registry always agree.
// The server decides the state; this component never infers one. A missing
// object is shown as plain "Registered" (never as verified).
const BADGE_CLASS = {
  registered: 'badge-neutral',
  identity_pending: 'badge-amber',
  identity_verified: 'badge-teal',
  donation_evidence_verified: 'badge-teal',
  trusted: 'badge-teal',
};

const BADGE_TITLE = {
  registered: 'Registered. No identity document has been approved.',
  identity_pending: 'An identity document is waiting for admin review.',
  identity_verified: 'An admin approved this donor\u2019s identity document. This is not a medical check and does not verify blood group.',
  donation_evidence_verified: 'An admin approved this donor\u2019s donation evidence. This is not a medical check and does not verify blood group.',
  trusted: 'Identity and donation evidence approved, account in good standing, no upheld reports. Not a medical check; blood group is not verified.',
};

export default function VerificationBadge({ verification, style, uppercase = false }) {
  const key = verification && BADGE_CLASS[verification.badge] ? verification.badge : 'registered';
  const label = verification?.label && key === verification.badge ? verification.label : 'Registered';
  const showIcon = key === 'identity_verified' || key === 'donation_evidence_verified' || key === 'trusted';
  return (
    <span className={`badge ${BADGE_CLASS[key]}`} title={BADGE_TITLE[key]} style={style}>
      {showIcon && <ShieldCheckIcon size={12} />} {uppercase ? label.toUpperCase() : label}
    </span>
  );
}
