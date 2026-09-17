// Shared validation rules — one place to change signup/profile constraints
// instead of duplicating checks across routes.

export const ALLOWED_SIGNUP_ROLES = ['donor', 'requester'];
// Admin accounts are never created through public signup — they're
// provisioned directly by the team. Opening that up is a real attack
// surface for zero benefit at this scale.

export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

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
