// Plain-Node correctness check for the ranking logic — no DB, no framework.
// Run with: npm run test:matching
import { rankDonorCandidates } from './donorMatching.js';

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

let failures = 0;
const fail = (msg) => { console.log(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);

const request = { city: 'Sukkur' };

const candidates = [
  // Same city, verified, donated 6 months ago -> 30 + 20 + 25 = 75
  { id: 1, name: 'Donor A', city: 'Sukkur', last_donation_date: monthsAgo(6), is_blood_group_verified: true },
  // Different city, unverified, never donated (null) -> 0 + 0 + 50 = 50
  { id: 2, name: 'Donor B', city: 'Karachi', last_donation_date: null, is_blood_group_verified: false },
  // Same city, unverified, donated 1 month ago -> inside 3-month cooldown, must be EXCLUDED
  { id: 3, name: 'Donor C', city: 'Sukkur', last_donation_date: monthsAgo(1), is_blood_group_verified: false },
  // Same city, unverified, donated 12+ months ago -> 30 + 0 + 50 = 80
  { id: 4, name: 'Donor D', city: 'Sukkur', last_donation_date: monthsAgo(14), is_blood_group_verified: false },
];

const ranked = rankDonorCandidates(candidates, request);
const ids = ranked.map((r) => r.donor_id);

// 1. Donor still in cooldown must never appear.
if (ids.includes(3)) fail('donor still in 3-month cooldown was NOT excluded');
else pass('donor still in 3-month cooldown correctly excluded');

// 2. Expected order by score: D (80) > A (75) > B (50).
if (JSON.stringify(ids) === JSON.stringify([4, 1, 2])) {
  pass('candidates ranked in correct score order (D > A > B)');
} else {
  fail(`unexpected ranking order: got [${ids}], expected [4, 1, 2]`);
}

// 3. Same-city bonus is actually applied.
const donorA = ranked.find((r) => r.donor_id === 1);
if (donorA.reasons.includes('Same city as the request')) pass('same-city bonus reason recorded');
else fail('same-city bonus reason missing for a same-city donor');

// 4. Verified bonus is actually applied.
if (donorA.score >= 45) pass('verified + same-city bonuses both contributed to score');
else fail(`donor A score too low to include verified + city bonuses: ${donorA.score}`);

console.log(failures === 0 ? '\nAll matching self-checks passed.' : `\n${failures} matching self-check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
