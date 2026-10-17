// Plain-Node correctness check for the urgent-alert validation rules — no DB,
// no framework. Run with: npm run test:alerts
import { parseIdParam, evaluateAlert, DONOR_NOT_AVAILABLE_MESSAGE } from './alertRules.js';

let failures = 0;
const fail = (msg) => { console.log(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));

// --- parseIdParam ---------------------------------------------------------

for (const good of ['1', '7', '42', '2147483647']) {
  expect(parseIdParam(good) === Number(good), `id "${good}" is accepted`);
}
for (const bad of ['', '0', '-1', '1.5', '1e3', '0x10', ' 7', '7 ', '007', 'abc', '7abc', '2147483648', '99999999999999999999', 'NaN', 'Infinity', undefined, null, 5, {}]) {
  expect(parseIdParam(bad) === null, `id ${JSON.stringify(bad)} is rejected`);
}

// --- evaluateAlert --------------------------------------------------------

const NOW = Date.parse('2026-10-16T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const TTL = 48;

const baseRequest = () => ({
  id: 10, blood_group: 'A+', status: 'verified', is_verified: 1,
  required_by: new Date(NOW + 5 * HOUR), created_at: new Date(NOW - HOUR),
});
const baseAccount = () => ({ id: 20, role: 'donor', is_suspended: 0 });
const baseProfile = () => ({
  blood_group: 'O+', is_available: 1, current_status: 'AVAILABLE', last_donation_date: null,
});
const run = (over = {}) => evaluateAlert({
  request: baseRequest(), donorAccount: baseAccount(), donorProfile: baseProfile(),
  existingResponse: undefined, ttlHours: TTL, now: NOW, ...over,
});

// The happy path still works.
expect(run().ok === true, 'verified, open request + available compatible donor -> allowed');
expect(run({ request: { ...baseRequest(), status: 'matched' } }).ok === true, "'matched' request -> allowed");
expect(run({ request: { ...baseRequest(), required_by: null } }).ok === true, 'no needed-by time, inside default TTL -> allowed');
expect(run({ donorProfile: { ...baseProfile(), last_donation_date: '2025-01-01' } }).ok === true, 'donor past cooldown -> allowed');

// Request-side rejections (409, specific message — the requester owns this request).
{
  const r = run({ request: undefined });
  expect(!r.ok && r.status === 404, 'missing / not-owned request -> 404');
}
{
  const r = run({ request: { ...baseRequest(), is_verified: 0 } });
  expect(!r.ok && r.status === 409 && /not been verified/.test(r.message), 'un-verified request -> 409');
}
{
  const r = run({ request: { ...baseRequest(), status: 'pending', is_verified: 0 } });
  expect(!r.ok && r.status === 409, 'pending request -> 409');
}
for (const status of ['donor_accepted', 'fulfilled', 'expired', 'cancelled', 'pending']) {
  const r = run({ request: { ...baseRequest(), status } });
  expect(!r.ok && r.status === 409, `request in status '${status}' -> 409`);
}
{
  const r = run({ request: { ...baseRequest(), required_by: new Date(NOW - HOUR) } });
  expect(!r.ok && r.status === 409 && /needed-by/.test(r.message), 'needed-by time passed -> 409');
}
{
  const r = run({ request: { ...baseRequest(), required_by: null, created_at: new Date(NOW - 49 * HOUR) } });
  expect(!r.ok && r.status === 409 && /expired/.test(r.message), 'no needed-by time and older than default TTL -> 409');
}

// Donor-side rejections (all 404 with the same generic message).
const donorDenied = (label, over) => {
  const r = run(over);
  expect(!r.ok && r.status === 404 && r.message === DONOR_NOT_AVAILABLE_MESSAGE, `${label} -> 404 generic`);
};
donorDenied('target id does not exist', { donorAccount: undefined, donorProfile: undefined });
donorDenied('target is an admin', { donorAccount: { ...baseAccount(), role: 'admin' }, donorProfile: undefined });
donorDenied('target is a requester', { donorAccount: { ...baseAccount(), role: 'requester' }, donorProfile: undefined });
donorDenied('target is a requester even with a stray donor profile', { donorAccount: { ...baseAccount(), role: 'requester' } });
donorDenied('target has no donor profile', { donorProfile: undefined });
donorDenied('donor is suspended', { donorAccount: { ...baseAccount(), is_suspended: 1 } });
donorDenied('donor marked unavailable', { donorProfile: { ...baseProfile(), is_available: 0 } });
for (const current_status of ['MATCHED', 'COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED', 'COOLDOWN']) {
  donorDenied(`donor in ${current_status}`, { donorProfile: { ...baseProfile(), current_status } });
}
donorDenied('donor blood group incompatible (A+ donor, O- request)', {
  request: { ...baseRequest(), blood_group: 'O-' }, donorProfile: { ...baseProfile(), blood_group: 'A+' },
});
donorDenied('donor blood group incompatible (AB+ donor, A+ request)', {
  donorProfile: { ...baseProfile(), blood_group: 'AB+' },
});
donorDenied('donor inside post-donation cooldown', {
  donorProfile: { ...baseProfile(), last_donation_date: new Date(NOW - 10 * 24 * HOUR).toISOString().slice(0, 10) },
});

// Existing responses are never overwritten.
{
  const r = run({ existingResponse: { status: 'declined' } });
  expect(!r.ok && r.status === 404 && r.message === DONOR_NOT_AVAILABLE_MESSAGE, "a donor's 'declined' answer is not flipped back to notified");
}
{
  const r = run({ existingResponse: { status: 'accepted' } });
  expect(!r.ok && r.status === 404, "a donor's 'accepted' answer is not overwritten");
}
{
  const r = run({ existingResponse: { status: 'notified' } });
  expect(!r.ok && r.status === 409 && /already been alerted/.test(r.message), 'repeat alert to the same donor -> 409');
}

// Order: a bad request is reported before donor details are examined.
{
  const r = run({ request: { ...baseRequest(), status: 'cancelled' }, donorAccount: undefined });
  expect(!r.ok && r.status === 409, 'closed request is reported ahead of donor problems');
}

console.log(failures === 0 ? '\nAll alert-rule self-checks passed.' : `\n${failures} alert-rule self-check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
