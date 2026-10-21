// Pure rules for request evidence and its admin review. No database access
// here: the service layer feeds in what the database says and this decides
// what is allowed.
//
// Supporting evidence is MANDATORY when a request is created: POST
// /api/requests refuses a request that has no valid document attached, and the
// request and its evidence are stored in one transaction. The same upload
// route is still used to resubmit after a rejection or a request for more
// information.
//
// Evidence review is separate from request verification. Nothing in this
// feature changes requests.is_verified or requests.status:
//   * a request cannot be created without evidence, but approving or rejecting
//     that evidence never changes the request itself;
//   * approving evidence does not verify the request;
//   * rejecting evidence or asking for more information does not cancel,
//     un-verify or block the request.
// Request verification stays exactly where it was (the admin "verify" action),
// and a donor can still only accept a request that action has verified.
//
// "Latest" means the most recent submission for a request, so a resubmission
// after a rejection or a request for more information replaces the earlier
// outcome while the earlier rows stay as history.

export const EVIDENCE_STATUSES = ['pending', 'approved', 'rejected', 'more_info'];

// Admin action name -> stored status.
export const REVIEW_DECISIONS = {
  approve: 'approved',
  reject: 'rejected',
  request_info: 'more_info',
};

export const MAX_EVIDENCE_FILES = 3; // e.g. slip front/back plus a ward letter
export const MAX_EVIDENCE_SUBMISSIONS_PER_DAY = 10; // per requester, rolling 24 h
export const MAX_EVIDENCE_SUBMISSIONS_PER_REQUEST = 5; // keeps stored files bounded
export const NOTE_MAX_LENGTH = 500;

// Requests in these statuses are live. Evidence can be added to, and reviewed
// on, a live request only; a fulfilled / cancelled / expired one is history.
export const LIVE_REQUEST_STATUSES = ['pending', 'verified', 'matched', 'donor_accepted'];

export const EVIDENCE_REQUIRED_MESSAGE =
  'Supporting evidence is required. Attach 1 to 3 documents (JPEG, PNG, WebP or PDF, up to 5 MB each), ' +
  'such as a hospital slip or letter, before submitting a blood request.';

export const EVIDENCE_NOTICE =
  'Supporting evidence is required for every blood request and is reviewed by an admin. ' +
  'Reviewing evidence does not change whether the request itself is verified.';

// Optional text field (requester note, admin internal note). Returns an error
// message, or null when absent or valid.
export function validateOptionalText(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return `${label} must be text`;
  if (value.trim().length > NOTE_MAX_LENGTH) {
    return `${label} must be ${NOTE_MAX_LENGTH} characters or fewer`;
  }
  return null;
}

export function normalizeOptionalText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// What a requester may submit next, given the status of the LATEST submission
// (null when there is none) and the request's lifecycle status.
//   none / rejected / more_info -> allowed
//   pending / approved          -> not allowed (already waiting / accepted)
// Returns { ok: true } or { ok: false, httpStatus, reason }.
export function evaluateEvidenceSubmission({ latestStatus = null, requestStatus }) {
  if (!LIVE_REQUEST_STATUSES.includes(requestStatus)) {
    return {
      ok: false,
      httpStatus: 409,
      reason: `This request is ${String(requestStatus).replace(/_/g, ' ')}, so evidence can no longer be added.`,
    };
  }
  if (latestStatus === 'pending') {
    return { ok: false, httpStatus: 409, reason: 'Your evidence is already waiting for admin review.' };
  }
  if (latestStatus === 'approved') {
    return { ok: false, httpStatus: 409, reason: 'Your evidence has already been approved.' };
  }
  return { ok: true };
}

export function canRequesterSubmit({ latestStatus = null, requestStatus }) {
  return evaluateEvidenceSubmission({ latestStatus, requestStatus }).ok;
}

// Decides whether an admin may record `decision` on a submission.
//   { ok: true, newStatus }                -> go ahead
//   { ok: false, httpStatus, reason }      -> refused, nothing changes
// Rules:
//   - the decision must be one of approve / reject / request_info;
//   - only the LATEST submission of a request can be decided: an older one was
//     superseded by a resubmission;
//   - the request must still be live;
//   - approving something already approved is refused (no silent no-op);
//     re-sending reject / request_info updates the message and is logged;
//   - a decision may change an earlier one (approved -> rejected, rejected ->
//     approved, more_info -> approved, ...), so a wrong call can be corrected.
export function decideReview({ currentStatus, decision, isLatest, requestStatus }) {
  const newStatus = REVIEW_DECISIONS[decision];
  if (!newStatus) {
    return {
      ok: false,
      httpStatus: 400,
      reason: `decision must be one of: ${Object.keys(REVIEW_DECISIONS).join(', ')}`,
    };
  }
  if (!isLatest) {
    return {
      ok: false,
      httpStatus: 409,
      reason: 'A newer submission exists for this request. Review the newest one instead.',
    };
  }
  if (!LIVE_REQUEST_STATUSES.includes(requestStatus)) {
    return {
      ok: false,
      httpStatus: 409,
      reason: `This request is ${String(requestStatus).replace(/_/g, ' ')}, so its evidence can no longer be reviewed.`,
    };
  }
  if (newStatus === 'approved' && currentStatus === 'approved') {
    return { ok: false, httpStatus: 409, reason: 'This evidence is already approved.' };
  }
  return { ok: true, newStatus };
}

// The requester only ever sees the message for the two outcomes that ask
// something of them. Reviewer identity and internal notes are never included.
export function requesterFeedback(status, decisionReason) {
  if (status === 'rejected' || status === 'more_info') return decisionReason || null;
  return null;
}
