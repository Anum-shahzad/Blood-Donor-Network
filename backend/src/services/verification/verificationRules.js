// Pure rules for staged verification. No database access here: the service
// layer feeds in what the database says and this decides the level.
//
// Levels are DERIVED, never stored and never writable by the user:
//   1  Registered                   — every donor account
//   2  Identity verification pending — latest identity submission is pending
//   3  Identity verified            — latest identity submission is approved
//   4  Donation evidence verified   — level 3 AND latest evidence is approved
//   5  Trusted                      — level 4 AND account in good standing AND
//                                     no upheld reports
//
// "Latest" means the most recent submission of that type, so a re-submission
// after a rejection or revocation replaces the earlier outcome.

export const SUBMISSION_TYPES = ['identity', 'donation_evidence'];
export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'revoked'];

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
export const MAX_FILES_PER_SUBMISSION = 2; // e.g. front and back of an ID card
export const MAX_SUBMISSIONS_PER_DAY = 5; // per user, rolling 24 h
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 500;

// Shown wherever a level or badge is shown. Verification is about the
// account, never about health.
export const VERIFICATION_NOTICE =
  'Verification confirms who an account belongs to and that a past donation is documented. ' +
  'It does not verify blood group: a blood group is self-reported here and is only confirmed by testing at a blood bank or hospital. ' +
  'It is not a medical check and does not mean anyone is medically fit to donate. ' +
  'Fitness to donate is always decided by a licensed blood bank or hospital screening.';

export const LEVEL_INFO = {
  1: {
    label: 'Registered',
    description: 'Your account is registered. Identity verification is optional.',
  },
  2: {
    label: 'Identity verification pending',
    description: 'Your identity document is waiting for admin review.',
  },
  3: {
    label: 'Identity verified',
    description: 'An admin has approved your identity document. This does not verify your blood group or medical fitness.',
  },
  4: {
    label: 'Donation evidence verified',
    description: 'An admin has approved your evidence of a previous donation. This does not verify your blood group or medical fitness.',
  },
  5: {
    label: 'Trusted',
    description:
      'Identity and donation evidence are approved, your account is in good standing, and no reports against you have been upheld.',
  },
};

// identityStatus / donationEvidenceStatus: the status of the LATEST submission
// of that type, or null when there is none.
export function computeVerificationLevel({
  identityStatus = null,
  donationEvidenceStatus = null,
  isSuspended = false,
  hasUpheldReport = false,
} = {}) {
  if (identityStatus === 'approved') {
    if (donationEvidenceStatus === 'approved') {
      return !isSuspended && !hasUpheldReport ? 5 : 4;
    }
    return 3;
  }
  if (identityStatus === 'pending') return 2;
  return 1;
}

// Compact, display-safe summary derived from a level. This is the ONLY shape
// other endpoints (donor cards, matches, admin registry) expose, so every
// screen shows the same states. blood_group_verified is always false: no
// evidence-review process in this project verifies a blood group, and identity
// or donation-evidence approval must never be read as one.
export const BADGE_KEYS = {
  1: 'registered',
  2: 'identity_pending',
  3: 'identity_verified',
  4: 'donation_evidence_verified',
  5: 'trusted',
};

export function describeVerification(level) {
  const safe = LEVEL_INFO[level] ? level : 1;
  return {
    level: safe,
    badge: BADGE_KEYS[safe],
    label: LEVEL_INFO[safe].label,
    identity_verified: safe >= 3,
    donation_evidence_verified: safe >= 4,
    trusted: safe === 5,
    blood_group_verified: false,
  };
}

// What a donor may submit next, given the latest status of each type.
//   identity           : allowed unless one is pending or already approved
//   donation_evidence  : needs approved identity first; then same rule
export function submissionPermissions({ identityStatus = null, donationEvidenceStatus = null } = {}) {
  const identityBlocked = identityStatus === 'pending' || identityStatus === 'approved';
  const evidenceBlocked =
    donationEvidenceStatus === 'pending' || donationEvidenceStatus === 'approved';
  return {
    identity: !identityBlocked,
    donation_evidence: identityStatus === 'approved' && !evidenceBlocked,
  };
}

export function validateReason(value) {
  if (typeof value !== 'string') return 'A reason is required';
  const trimmed = value.trim();
  if (trimmed.length < REASON_MIN_LENGTH) {
    return `A reason of at least ${REASON_MIN_LENGTH} characters is required`;
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    return `The reason must be ${REASON_MAX_LENGTH} characters or fewer`;
  }
  return null;
}
