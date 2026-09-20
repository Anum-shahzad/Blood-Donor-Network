// Plain-Node correctness check for the donor state machine — no DB, no
// framework. Run with: npm run test:donor-state
import {
  canDonorAccept,
  canRequestAcceptDonor,
  canDonorCancelCommitment,
  requestStatusAfterAccept,
  requestStatusAfterCommitmentCancelled,
} from './donorState.js';

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

console.log(failures === 0 ? '\nAll donor-state self-checks passed.' : `\n${failures} donor-state self-check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
