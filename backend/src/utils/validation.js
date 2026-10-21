// Shared validation rules — one place to change signup/profile/request
// constraints instead of duplicating checks across routes.
import { parseCoordinates } from '../services/geo.js';

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
  if (body.role === 'donor' && !BLOOD_GROUPS.includes(body.blood_group)) {
    errors.push(`blood_group is required for donors and must be one of: ${BLOOD_GROUPS.join(', ')}`);
  }
  if (!body.city || typeof body.city !== 'string' || body.city.trim().length < 2) {
    errors.push('city is required');
  }
  if (body.phone && (typeof body.phone !== 'string' || !/^[0-9+()\-\s]{6,30}$/.test(body.phone.trim()))) {
    errors.push('phone must be 6-30 characters (digits, spaces, + - ( ) only)');
  }
  if (body.role === 'donor' && body.last_donation_date) {
    const dateError = validateDonationDate(body.last_donation_date);
    if (dateError) errors.push(dateError);
  }

  return errors;
}

// A donation date must be a real calendar date (YYYY-MM-DD) that is not in
// the future. Returns an error message, or null when valid.
//
// "Not in the future" is judged against the latest calendar date that exists
// anywhere on Earth right now (UTC+14). That keeps a donor in any time zone
// from being rejected for logging "today" just after their local midnight,
// while still refusing any date that has not started yet for anyone.
// `label` only changes the field name used in the error message.
export const DONATION_COOLDOWN_DAYS = 90;
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function validateDonationDate(value, label = 'last_donation_date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${label} must be a date in YYYY-MM-DD format`;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return `${label} is not a real date`;
  }
  const latestAllowed = new Date(Date.now() + MAX_UTC_OFFSET_MS).toISOString().slice(0, 10);
  if (value > latestAllowed) {
    return `${label} cannot be in the future`;
  }
  // Nobody has donated blood before 1950 and still has a live donor account;
  // this just stops absurd values reaching the date arithmetic.
  if (value < '1950-01-01') {
    return `${label} is too far in the past`;
  }
  return null;
}

// Whole days from date string a to date string b (both YYYY-MM-DD).
export function daysBetween(a, b) {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS
  );
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
  // Optional exact hospital location (both numbers or neither).
  const coords = parseCoordinates(body.latitude, body.longitude);
  if (!coords.ok) {
    errors.push(coords.error);
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
