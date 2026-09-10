// Plain-Node correctness check for blood compatibility — no test framework
// required. Run with: npm run test:compatibility
import { getCompatibleDonorGroups, ALL_BLOOD_GROUPS } from './compatibility.js';

// Expected donor sets per recipient, derived from standard ABO/Rh rules.
const EXPECTED = {
  'O-':  ['O-'],
  'O+':  ['O-', 'O+'],
  'A-':  ['O-', 'A-'],
  'A+':  ['O-', 'O+', 'A-', 'A+'],
  'B-':  ['O-', 'B-'],
  'B+':  ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ALL_BLOOD_GROUPS, // universal recipient
};

let failures = 0;

for (const recipient of ALL_BLOOD_GROUPS) {
  const actual = [...getCompatibleDonorGroups(recipient)].sort();
  const expected = [...EXPECTED[recipient]].sort();
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  recipient=${recipient}  expected=[${expected}]  actual=[${actual}]`
  );
  if (!pass) failures++;
}

if (failures === 0) {
  console.log('\nAll 8 compatibility checks passed.');
  process.exit(0);
} else {
  console.log(`\n${failures} compatibility check(s) FAILED.`);
  process.exit(1);
}
