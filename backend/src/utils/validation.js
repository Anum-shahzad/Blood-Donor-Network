// Shared validation rules — one place to change signup/profile/request
// constraints instead of duplicating checks across routes.

export const ALLOWED_SIGNUP_ROLES = ['donor', 'requester'];
// Admin accounts are never created through public signup — they're
// provisioned directly by the team. Opening that up is a real attack
// surface for zero benefit at this scale.

export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
export const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];

// Statuses a requester can set by hand. pending/verified/matched are
// system-driven (verification, matching); a requester can only ever close
// their own request out as fulfilled or cancelled it themselves.
export const MANUAL_REQUEST_STATUSES = ['fulfilled', 'cancelled'];
export const CLOSED_REQUEST_STATUSES = ['fulfilled', 'cancelled', 'expired'];

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

export function validateSignupPayload(body) {
  const errors = [];

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    errors.push('name is required (min 2 characters)');
  }
  if (!isValidEmail(body.email)) {
    errors.push('a valid email is required');
  }
  if (!isValidPassword(body.password)) {
    errors.push('password must be at least 8 characters');
  }
  if (!ALLOWED_SIGNUP_ROLES.includes(body.role)) {
    errors.push(`role must be one of: ${ALLOWED_SIGNUP_ROLES.join(', ')}`);
  }
  if (body.role === 'donor' && body.blood_group && !BLOOD_GROUPS.includes(body.blood_group)) {
    errors.push(`blood_group must be one of: ${BLOOD_GROUPS.join(', ')}`);
  }

  return errors;
}

export function validateRequestPayload(body) {
  const errors = [];

  if (!BLOOD_GROUPS.includes(body.blood_group)) {
    errors.push(`blood_group must be one of: ${BLOOD_GROUPS.join(', ')}`);
  }
  const units = Number(body.units_needed);
  if (!Number.isInteger(units) || units < 1 || units > 20) {
    errors.push('units_needed must be a whole number between 1 and 20');
  }
  if (!body.hospital_name || typeof body.hospital_name !== 'string' || body.hospital_name.trim().length < 2) {
    errors.push('hospital_name is required');
  }
  if (!body.city || typeof body.city !== 'string' || body.city.trim().length < 2) {
    errors.push('city is required');
  }
  if (body.urgency && !URGENCY_LEVELS.includes(body.urgency)) {
    errors.push(`urgency must be one of: ${URGENCY_LEVELS.join(', ')}`);
  }
  if (body.required_by) {
    const parsed = new Date(body.required_by);
    if (Number.isNaN(parsed.getTime())) {
      errors.push('required_by must be a valid date/time');
    } else if (parsed.getTime() < Date.now() - 5 * 60 * 1000) {
      // Small grace window for clock skew between browser and server.
      errors.push('required_by cannot be in the past');
    }
  }

  return errors;
}
