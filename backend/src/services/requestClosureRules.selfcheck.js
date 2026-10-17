// Plain-Node correctness check for the request-closure rules (L-02) — no DB, no
// framework. Run with: npm run test:request-closure
import { decideClosure, donorOutcomeAfterRelease } from './requestClosureRules.js';

let failures = 0;
const fail = (msg) => { console.log(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

// --- decideClosure: live requests may be closed ------------------------------
for (const status of ['pending', 'verified', 'matched', 'donor_accepted']) {
  for (const target of ['fulfilled', 'cancelled']) {
    const d = decideClosure(status, target);
    check(d.ok && d.action === 'apply', `${status} -> ${target} is applied`);
  }
}

// --- decideClosure: repeating the same close is a safe no-op -----------------
for (const status of ['fulfilled', 'cancelled']) {
  const d = decideClosure(status, status);
  check(d.ok && d.action === 'noop', `repeating ${status} is an idempotent no-op`);
}

// --- decideClosure: history is never rewritten -------------------------------
const refused = [
  ['fulfilled', 'cancelled'],   // reject/cancel a fulfilled request
  ['cancelled', 'fulfilled'],   // fulfil a cancelled request
  ['expired', 'cancelled'],     // rewrite an expired request
  ['expired', 'fulfilled'],
];
for (const [from, to] of refused) {
  const d = decideClosure(from, to);
  check(!d.ok && d.httpStatus === 409 && d.reason.includes(from), `${from} -> ${to} is refused with 409`);
}
check(!decideClosure('mystery', 'cancelled').ok, 'an unknown status is refused, not closed');
check(decideClosure('verified', 'expired').httpStatus === 400, 'only fulfilled/cancelled are valid targets (400)');
check(decideClosure('verified', undefined).httpStatus === 400, 'a missing target is refused (400)');

// --- donorOutcomeAfterRelease: driven by last_donation_date ------------------
const dayStr = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

let o = donorOutcomeAfterRelease(null);
check(o.current_status === 'AVAILABLE' && o.keepIsAvailable && o.cooldown_until === null,
  'no donation on record -> AVAILABLE, is_available left alone');

o = donorOutcomeAfterRelease(dayStr(-200));
check(o.current_status === 'AVAILABLE' && o.keepIsAvailable, 'long-expired cooldown -> AVAILABLE');

o = donorOutcomeAfterRelease(dayStr(-91));
check(o.current_status === 'AVAILABLE', '91 days ago -> AVAILABLE');

o = donorOutcomeAfterRelease(dayStr(-89));
check(o.current_status === 'COOLDOWN' && o.keepIsAvailable === false && /^\d{4}-\d{2}-\d{2}$/.test(o.cooldown_until),
  '89 days ago (one day short) -> COOLDOWN, is_available off, cooldown_until set');

o = donorOutcomeAfterRelease(dayStr(-10));
check(o.current_status === 'COOLDOWN' && o.cooldown_until === dayStr(80),
  'donated 10 days ago -> COOLDOWN until 80 days from now');

o = donorOutcomeAfterRelease(dayStr(-5), 30);
check(o.current_status === 'COOLDOWN', 'honours a custom cooldown length (5 days into 30)');
o = donorOutcomeAfterRelease(dayStr(-31), 30);
check(o.current_status === 'AVAILABLE', 'honours a custom cooldown length (31 days into 30)');

console.log(failures === 0 ? '\nAll request-closure self-checks passed.' : `\n${failures} request-closure self-check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
