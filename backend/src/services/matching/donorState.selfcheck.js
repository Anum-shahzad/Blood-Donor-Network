// Plain-Node correctness check for the donor state machine — no DB, no
// framework. Run with: npm run test:donor-state
import {
  canDonorAccept,
  canRequestAcceptDonor,
  canDonorCancelCommitment,
  requestStatusAfterAccept,
  requestStatusAfterCommitmentCancelled,
  cooldownCutoffDate,
  computeCooldownInfo,
} from './donorState.js';
import { isEligibleByRecency } from './donorMatching.js';

let failures = 0;
const fail = (msg) => { console.log(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);

// --- canDonorAccept -------------------------------------------------------

if (canDonorAccept({ current_status: 'AVAILABLE', is_available: true }).ok) {
  pass('AVAILABLE + is_available donor can accept');
} else {
  fail('AVAILABLE + is_available donor was blocked from accepting');
}

if (!canDonorAccept({ current_status: 'AVAILABLE', is_available: false }).ok) {
  pass('donor who marked themselves unavailable cannot accept');
} else {
  fail('donor who marked themselves unavailable was allowed to accept');
}

for (const status of ['COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED', 'COOLDOWN', 'MATCHED']) {
  const result = canDonorAccept({ current_status: status, is_available: true });
  if (!result.ok) pass(`donor in ${status} cannot accept a second request`);
  else fail(`donor in ${status} was WRONGLY allowed to accept a second request`);
}

if (!canDonorAccept(null).ok) {
  pass('missing donor profile cannot accept');
} else {
  fail('missing donor profile was allowed to accept');
}

// --- canRequestAcceptDonor -------------------------------------------------

for (const status of ['verified', 'matched']) {
  if (canRequestAcceptDonor({ status }).ok) pass(`request in status=${status} is open for accept`);
  else fail(`request in status=${status} was WRONGLY closed for accept`);
}

for (const status of ['pending', 'donor_accepted', 'fulfilled', 'expired', 'cancelled']) {
  if (!canRequestAcceptDonor({ status }).ok) pass(`request in status=${status} correctly rejects a new accept`);
  else fail(`request in status=${status} WRONGLY accepted a donor`);
}

if (!canRequestAcceptDonor(null).ok) {
  pass('missing request cannot be accepted');
} else {
  fail('missing request was accepted');
}

// --- canDonorCancelCommitment ----------------------------------------------

if (canDonorCancelCommitment({ current_status: 'COMMITTED' }).ok) {
  pass('COMMITTED donor can cancel their commitment');
} else {
  fail('COMMITTED donor was blocked from cancelling');
}

for (const status of ['AVAILABLE', 'EN_ROUTE', 'ARRIVED', 'MATCHED']) {
  if (!canDonorCancelCommitment({ current_status: status }).ok) {
    pass(`donor in ${status} cannot cancel a commitment that isn't COMMITTED`);
  } else {
    fail(`donor in ${status} was WRONGLY allowed to cancel`);
  }
}

// --- transition lookups ------------------------------------------------

if (requestStatusAfterAccept() === 'donor_accepted') pass('accept transitions request to donor_accepted');
else fail('accept did not transition request to donor_accepted');

if (requestStatusAfterCommitmentCancelled() === 'matched') pass('cancelled commitment reopens request to matched');
else fail('cancelled commitment did not reopen request to matched');

// --- cooldown expiry cutoff (audit L-01) -------------------------------
// releaseExpiredCooldowns() turns cooldownCutoffDate() into a SQL comparison
// (last_donation_date <= cutoff). That must flip at exactly the same moment as
// the two rules the rest of the app already uses to decide eligibility:
// computeCooldownInfo() (dashboard) and isEligibleByRecency() (accept path).
// Time is frozen so the boundary checks are deterministic.

const RealDate = Date;
function withFrozenClock(isoNow, fn) {
  const frozen = RealDate.parse(isoNow);
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length === 0) super(frozen); else super(...args); }
    static now() { return frozen; }
  };
  try { return fn(frozen); } finally { globalThis.Date = RealDate; }
}
const dayOffset = (isoNow, days) =>
  new RealDate(RealDate.parse(isoNow) + days * 86400000).toISOString().split('T')[0];

if (withFrozenClock('2026-10-17T12:00:00Z', (now) => cooldownCutoffDate(now, 90)) === '2026-07-19') {
  pass('cutoff for 2026-10-17 with a 90-day cooldown is 2026-07-19');
} else {
  fail('cutoff date is wrong for a known date');
}

for (const clock of ['2026-10-17T00:00:00.000Z', '2026-10-17T12:34:56Z', '2026-10-17T23:59:59.999Z', '2027-03-01T00:00:00Z']) {
  for (const offset of [-200, -91, -90, -89, -1, 0]) {
    withFrozenClock(clock, (now) => {
      const donated = dayOffset(clock, offset);
      const bySweep = donated <= cooldownCutoffDate(now, 90);
      const byDashboard = computeCooldownInfo(donated, 90).isEligible;
      const byAccept = isEligibleByRecency(donated);
      if (bySweep === byDashboard && bySweep === byAccept) {
        pass(`at ${clock}, donation ${-offset} days ago: sweep, dashboard and accept rules agree (eligible=${bySweep})`);
      } else {
        fail(`at ${clock}, donation ${-offset} days ago: sweep=${bySweep} dashboard=${byDashboard} accept=${byAccept}`);
      }
    });
  }
}

withFrozenClock('2026-10-17T12:00:00Z', (now) => {
  const cutoff = cooldownCutoffDate(now, 90);
  if (dayOffset('2026-10-17T12:00:00Z', -90) === cutoff) {
    pass('a donation exactly 90 days ago sits on the cutoff, so it is released');
  } else {
    fail('90-day boundary is off by one');
  }
  if (dayOffset('2026-10-17T12:00:00Z', -89) > cutoff) pass('89 days ago is not yet eligible');
  else fail('89 days ago was treated as eligible');
});

if (cooldownCutoffDate(RealDate.parse('2026-10-17T12:00:00Z'), 30) === '2026-09-17') {
  pass('cutoff honours a different cooldown length');
} else {
  fail('cutoff ignores the cooldownDays argument');
}

console.log(failures === 0 ? '\nAll donor-state self-checks passed.' : `\n${failures} donor-state self-check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
