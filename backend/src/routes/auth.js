import { verifyToken } from '../services/authService.js';
import { pool } from '../config/db.js';
import {
  suspensionMessage,
  describeSuspension,
  liftExpiredSuspensions,
  sweepExpiredSuspensions,
} from '../services/moderation/moderationService.js';

// Machine-readable code sent with every suspension denial so the frontend can
// tell "your account is suspended" apart from an ordinary 403 (wrong role).
export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';
export const ACCOUNT_SUSPENDED_MESSAGE =
  'Your account has been suspended. Please contact the administrator.';

// Shared by authenticate (every protected request) and the login route.
// Pass the users row to include the reason and end date the admin recorded.
// Callers only do that for someone who has proved who they are (valid token or
// verified password), so the reason is never shown to a stranger.
export function sendAccountSuspended(res, account) {
  return res.status(403).json({
    error: account ? suspensionMessage(account) : ACCOUNT_SUSPENDED_MESSAGE,
    code: ACCOUNT_SUSPENDED_CODE,
    ...(account ? { suspension: describeSuspension(account) } : {}),
  });
}

// Confirms the request carries a valid JWT, then re-checks the account in the
// database and attaches (id, role, email) to req.user for downstream handlers.
//
// The JWT alone is NOT enough: it stays valid for days and cannot be revoked,
// so the account's current state (still exists? suspended?) is read from the
// users table on every protected request. That is what makes suspension take
// effect immediately for tokens issued before the suspension.
//
// Administrators are never locked out by the suspension flag: the admin
// workflow is the only way to reactivate anyone, so a suspended admin would
// leave nobody able to undo it. The admin status endpoint also refuses to
// suspend an admin; this exemption is defence in depth.
export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice('Bearer '.length);

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    // Ends temporary suspensions that have run out (at most once a minute per
    // process), so the is_suspended flag other queries read stays accurate.
    await sweepExpiredSuspensions();

    const [rows] = await pool.query(
      'SELECT id, role, email, is_suspended, suspended_until, suspension_reason FROM users WHERE id = ?',
      [payload.id]
    );
    const account = rows[0];

    // Valid signature but the account no longer exists.
    if (!account) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // A temporary suspension whose time has passed ends now, for this person,
    // without waiting for the sweep.
    if (account.is_suspended && account.suspended_until) {
      if ((await liftExpiredSuspensions(account.id)) > 0) account.is_suspended = 0;
    }

    if (account.is_suspended && account.role !== 'admin') {
      return sendAccountSuspended(res, account);
    }

    // Role comes from the database, not the token, so the role used by
    // authorize() always matches the account's current record.
    req.user = { ...payload, id: account.id, role: account.role, email: account.email };
    next();
  } catch (err) {
    // If the account state can't be read, fail closed (500) rather than let
    // the request through unchecked.
    next(err);
  }
}

// Use after authenticate: authorize('donor'), authorize('admin', 'requester'), etc.
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
  };
}
