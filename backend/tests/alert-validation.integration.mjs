// Integration test for urgent-alert validation (Phase 1, Fix 6 / audit S-09).
//
// Run from the backend/ folder against a DISPOSABLE test database that already
// has schema.sql + migrations 001-006 applied. ALL TABLES ARE EMPTIED.
//
//   DB_HOST=127.0.0.1 DB_USER=... DB_PASSWORD=... DB_NAME=blood_donor_test \
//     node tests/alert-validation.integration.mjs [port]
//
// It refuses to run unless DB_NAME contains "test". It starts the real server
// (src/server.js) as a child process and talks to it over HTTP, so it exercises
// the real middleware, routes and database. Same conventions as
// tests/suspension.integration.mjs and tests/phone-privacy.integration.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const dir = process.cwd();
const port = process.argv[2] || '5057';
const { DB_HOST = '127.0.0.1', DB_PORT = '3306', DB_USER, DB_PASSWORD = '', DB_NAME } = process.env;
if (!DB_USER || !DB_NAME || !/test/i.test(DB_NAME)) {
  console.error('Set DB_USER and DB_NAME (the name must contain "test"). Refusing to run.');
  process.exit(2);
}
const BASE = `http://127.0.0.1:${port}`;
const env = {
  ...process.env, PORT: port, JWT_SECRET: 'test-secret-not-real', ADMIN_BOOTSTRAP_SECRET: 'bootstrap-test',
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME,
};
const mysql = createRequire(dir + '/package.json')('mysql2/promise');
const db = await mysql.createConnection({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
await db.query('SET FOREIGN_KEY_CHECKS=0');
for (const t of ['messages', 'conversations', 'request_responses', 'donations', 'requests', 'donor_profiles', 'users']) await db.query(`TRUNCATE ${t}`);
await db.query('SET FOREIGN_KEY_CHECKS=1');
const srv = spawn('node', ['src/server.js'], { cwd: dir, env, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {            // wait up to ~20s for the server to accept requests
  try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const signup = async (o) => (await call('POST', '/api/auth/signup', null, { password: 'password123', city: 'Testville', ...o })).json;
const alert = (token, requestId, donorId) => call('POST', `/api/requests/${requestId}/alert/${donorId}`, token, {});
const responseRows = async (requestId, donorId) =>
  (await db.query('SELECT status FROM request_responses WHERE request_id = ? AND donor_id = ?', [requestId, donorId]))[0];
const totalResponses = async () => (await db.query('SELECT COUNT(*) AS c FROM request_responses'))[0][0].c;

// Direct insert so the 3-requests-per-day cap and the "no past required_by" rule
// don't get in the way of setting up states the API would not let us create.
const mkRequest = async (requesterId, { status = 'verified', verified = 1, hoursFromNow = 5, bg = 'A+' } = {}) =>
  (await db.query(
    `INSERT INTO requests (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by, status, is_verified)
     VALUES (?, ?, 1, 'City Hospital', 'Testville', 'high', NOW() + INTERVAL ? HOUR, ?, ?)`,
    [requesterId, bg, hoursFromNow, status, verified]))[0].insertId;

// Asserts a rejected alert: expected status, optional message pattern, and that NO response row was added.
const expectDenied = async (name, status, token, requestId, donorId, msgRe) => {
  const before = await totalResponses();
  const r = await alert(token, requestId, donorId);
  check(`${name} -> ${status}`, r.status === status && (!msgRe || msgRe.test(r.json?.error || '')), `${r.status} ${r.text.slice(0, 160)}`);
  check(`   ...and no response row was written`, (await totalResponses()) === before);
};

try {
  const adminRes = await call('POST', '/api/auth/bootstrap-admin', null, { name: 'Admin', email: 'admin@test.dev', password: 'password123', secret: 'bootstrap-test' });
  const admin = adminRes.json.token, adminId = adminRes.json.user.id;

  const r1 = await signup({ name: 'Req One', email: 'r1@test.dev', role: 'requester', phone: '03001112223' });
  const r2 = await signup({ name: 'Req Two', email: 'r2@test.dev', role: 'requester', phone: '03004445556' });
  const donor = (name, email, blood_group, extra = {}) => signup({ name, email, role: 'donor', blood_group, ...extra });
  const dGood = await donor('Good', 'good@test.dev', 'O+');
  const dGood2 = await donor('Good Two', 'good2@test.dev', 'O-');
  const dAB = await donor('AB Pos', 'ab@test.dev', 'AB+');                 // cannot give to an A+ request
  const dOff = await donor('Unavailable', 'off@test.dev', 'O+');
  const dCool = await donor('Cooldown', 'cool@test.dev', 'O+', { last_donation_date: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10) });
  const dSusp = await donor('Suspended', 'susp@test.dev', 'O+');
  const dDecl = await donor('Decliner', 'decl@test.dev', 'O+');
  const dBusy = await donor('Committed', 'busy@test.dev', 'O+');
  const [R1, R2] = [r1.token, r2.token];
  const [r1id, r2id] = [r1.user.id, r2.user.id];

  const reqOK = await mkRequest(r1id);                                      // verified, open, A+
  const reqOK2 = await mkRequest(r1id);                                     // a second open request
  const reqUnverified = await mkRequest(r1id, { status: 'pending', verified: 0 });
  const reqUnverifiedFlag = await mkRequest(r1id, { status: 'verified', verified: 0 });
  const reqCancelled = await mkRequest(r1id, { status: 'cancelled' });
  const reqFulfilled = await mkRequest(r1id, { status: 'fulfilled' });
  const reqExpiredTime = await mkRequest(r1id, { hoursFromNow: -2 });
  const reqCommitted = await mkRequest(r1id);                               // will be accepted by dBusy
  const reqOther = await mkRequest(r2id);                                   // belongs to the other requester

  // ---- put donors into the states we need, through the real API ----
  check('setup: donor goes unavailable', (await call('PATCH', '/api/donors/me/availability', dOff.token, { is_available: false })).status === 200);
  check('setup: admin suspends a donor', (await call('PATCH', `/api/admin/donors/${dSusp.user.id}/status`, admin, { is_suspended: true })).status === 200);
  check('setup: a donor accepts a request (becomes COMMITTED)', (await call('POST', `/api/requests/${reqCommitted}/accept`, dBusy.token, {})).status === 200);
  check('setup: a donor declines reqOK', (await call('POST', `/api/requests/${reqOK}/decline`, dDecl.token, {})).status === 200);

  // =========================================================== HAPPY PATH — contract unchanged
  console.log('--- valid alert');
  const ok = await alert(R1, reqOK, dGood.user.id);
  check('valid alert -> 200 {status:"ok", message}', ok.status === 200 && ok.json?.status === 'ok' && /Emergency alert dispatched to donor for A\+ blood at City Hospital\./.test(ok.json?.message || ''), ok.text);
  const row = await responseRows(reqOK, dGood.user.id);
  check('   ...exactly one request_responses row, status notified', row.length === 1 && row[0].status === 'notified');
  const ok2 = await alert(R1, reqOK, dGood2.user.id);
  check('a second compatible donor can also be alerted for the same request', ok2.status === 200, ok2.text);
  const ok3 = await alert(R1, reqOK2, dGood.user.id);
  check('the same donor can be alerted for a different request', ok3.status === 200, ok3.text);
  await expectDenied('repeat alert to the same donor for the same request', 409, R1, reqOK, dGood.user.id, /already been alerted/);

  // =========================================================== MALFORMED INPUT
  console.log('--- malformed ids');
  for (const bad of ['0', '-1', '1.5', '1e3', '0x10', 'abc', '2147483648', '99999999999999999999', '%20', '007'])
    await expectDenied(`donorId "${bad}"`, 400, R1, reqOK, bad, /Invalid parameters/);
  for (const bad of ['0', '-1', 'abc', '1e2'])
    await expectDenied(`requestId "${bad}"`, 400, R1, bad, dGood.user.id, /Invalid parameters/);

  // =========================================================== AUTHORIZATION
  console.log('--- authorization');
  await expectDenied('no token', 401, null, reqOK, dGood2.user.id);
  await expectDenied('donor token', 403, dGood.token, reqOK, dGood2.user.id);
  await expectDenied('admin token', 403, admin, reqOK, dGood2.user.id);
  await expectDenied("another requester's request", 404, R2, reqOK, dGood2.user.id, /Request not found/);
  await expectDenied('request id that does not exist', 404, R1, 999999, dGood2.user.id, /Request not found/);
  await expectDenied('requester alerting for a request that is not theirs (reqOther)', 404, R1, reqOther, dGood2.user.id, /Request not found/);

  // =========================================================== REQUEST STATE
  console.log('--- request state');
  await expectDenied('pending / un-verified request', 409, R1, reqUnverified, dGood2.user.id, /not been verified/);
  await expectDenied('is_verified = 0 even though status says verified', 409, R1, reqUnverifiedFlag, dGood2.user.id, /not been verified/);
  await expectDenied('cancelled request', 409, R1, reqCancelled, dGood2.user.id, /cancelled/);
  await expectDenied('fulfilled request', 409, R1, reqFulfilled, dGood2.user.id, /fulfilled/);
  // The server's expiry sweep may already have flipped this to 'expired'; either way it must be refused.
  await expectDenied('request past its needed-by time', 409, R1, reqExpiredTime, dGood2.user.id, /needed-by|expired/);
  await expectDenied('request that already has a committed donor', 409, R1, reqCommitted, dGood2.user.id, /donor_accepted/);

  // =========================================================== TARGET MUST BE A VALID, AVAILABLE, COMPATIBLE DONOR
  console.log('--- donor validity (generic 404 so ids cannot be probed)');
  const generic = /^Donor not available$/;
  await expectDenied('donor id that does not exist', 404, R1, reqOK2, 987654, generic);
  await expectDenied('target is the admin account', 404, R1, reqOK2, adminId, generic);
  await expectDenied('target is another requester', 404, R1, reqOK2, r2id, generic);
  await expectDenied('target is the caller', 404, R1, reqOK2, r1id, generic);
  await expectDenied('suspended donor', 404, R1, reqOK2, dSusp.user.id, generic);
  await expectDenied('donor who marked themselves unavailable', 404, R1, reqOK2, dOff.user.id, generic);
  await expectDenied('donor already committed to another request', 404, R1, reqOK2, dBusy.user.id, generic);
  await expectDenied('donor inside the post-donation cooldown', 404, R1, reqOK2, dCool.user.id, generic);
  await expectDenied('donor with an incompatible blood group (AB+ -> A+)', 404, R1, reqOK2, dAB.user.id, generic);

  // =========================================================== A DECLINE IS NEVER UNDONE (the S-09 core)
  console.log('--- existing responses are never overwritten');
  await expectDenied("a donor who declined cannot be re-alerted", 404, R1, reqOK, dDecl.user.id, generic);
  const declinedRow = await responseRows(reqOK, dDecl.user.id);
  check("   ...and their row is still 'declined'", declinedRow.length === 1 && declinedRow[0].status === 'declined', JSON.stringify(declinedRow));
  const acceptedRow = await responseRows(reqCommitted, dBusy.user.id);
  check("a committed donor's 'accepted' row is untouched", acceptedRow.length === 1 && acceptedRow[0].status === 'accepted', JSON.stringify(acceptedRow));
  const stillNotified = await responseRows(reqOK, dGood.user.id);
  check("the earlier valid alert's row is still exactly one 'notified' row", stillNotified.length === 1 && stillNotified[0].status === 'notified');
} catch (e) { fail++; console.log('ERROR', e); }
finally { await db.end().catch(() => {}); srv.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
