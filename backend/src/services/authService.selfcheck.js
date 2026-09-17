// Plain-Node correctness check for hashing and JWT logic — no test framework,
// no database needed. Run with: npm run test:auth
process.env.JWT_SECRET = process.env.JWT_SECRET || 'selfcheck-only-secret-do-not-use-in-prod';

import { hashPassword, comparePassword, signToken, verifyToken } from './authService.js';

async function run() {
  let failures = 0;
  const fail = (msg) => { console.log(`FAIL: ${msg}`); failures++; };
  const pass = (msg) => console.log(`PASS: ${msg}`);

  // 1. Passwords are hashed, never stored as-is.
  const plain = 'SuperSecret123';
  const hash = await hashPassword(plain);
  if (hash === plain) fail('password was stored as plaintext');
  else pass('password is hashed before storage');

  // 2. Correct password matches its own hash.
  if (await comparePassword(plain, hash)) pass('correct password matches its hash');
  else fail('correct password did not match its own hash');

  // 3. Wrong password is rejected.
  if (await comparePassword('WrongPassword1', hash)) fail('wrong password matched the hash');
  else pass('wrong password correctly rejected');

  // 4. JWT round-trips the right payload.
  const token = signToken({ id: 42, role: 'donor', email: 'a@b.com' });
  const payload = verifyToken(token);
  if (payload.id === 42 && payload.role === 'donor' && payload.email === 'a@b.com') {
    pass('JWT signs and verifies the correct payload');
  } else {
    fail('JWT payload did not round-trip correctly');
  }

  // 5. A tampered token is rejected, not silently accepted.
  const tampered = token.slice(0, -4) + 'abcd';
  try {
    verifyToken(tampered);
    fail('tampered token was accepted');
  } catch {
    pass('tampered token correctly rejected');
  }

  console.log(failures === 0 ? '\nAll auth self-checks passed.' : `\n${failures} auth self-check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
