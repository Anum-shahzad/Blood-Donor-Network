// Integration test for urgent-alert request visibility (Phase 2, Fix L-03).
//
// Run from the backend/ folder against a DISPOSABLE test database that already
// has schema.sql + migrations 001-006 applied. ALL TABLES ARE EMPTIED.
//
//   DB_HOST=127.0.0.1 DB_USER=... DB_PASSWORD=... DB_NAME=blood_donor_test \
//     node tests/alert-visibility.integration.mjs [port]
//
// It refuses to run unless DB_NAME contains "test". It starts the real server
// (src/server.js) as a child process and talks to it over HTTP. Same
// conventions as tests/alert-validation.integration.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const dir = process.cwd();
const port = process.argv[2] || '5058';
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
const matchIds = async (token) => ((await call('GET', '/api/donors/matches', token)).json?.matches || []).map((m) => m.id);
const rows = async (requestId, donorId) =>
  (await db.query('SELECT status FROM request_responses WHERE request_id = ? AND donor_id = ?', [requestId, donorId]))[0];

const mkRequest = async (requesterId, { status = 'verified', verified = 1, hoursFromNow = 5, bg = 'A+' } = {}) =>
  (await db.query(
    `INSERT INTO requests (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by, status, is_verified)
     VALUES (?, ?, 1, 'City Hospital', 'Testville', 'high', NOW() + INTERVAL ? HOUR, ?, ?)`,
    [requesterId, bg, hoursFromNow, status, verified]))[0].insertId;

try {
  const r1 = await signup({ name: 'Req One', email: 'r1@test.dev', role: 'requester', phone: '03001112223' });
  const donor = (name, email, blood_group, extra = {}) => signup({ name, email, role: 'donor', blood_group, ...extra });
  const dAlerted = await donor('Alerted', 'alerted@test.dev', 'O+');
  const dOther = await donor('Never Alerted', 'other@test.dev', 'O+');
  const dDecline = await donor('Alert Then Decline', 'decline@test.dev', 'O+');
  const dAB = await donor('AB Pos', 'ab@test.dev', 'AB+');                      // cannot give to A+
  const dCool = await donor('Cooldown', 'cool@test.dev', 'O+', { last_donation_date: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10) });
  const dOff = await donor('Unavailable', 'off@test.dev', 'O+');
  const R1 = r1.token, r1id = r1.user.id;

  const reqA = await mkRequest(r1id);                 // main scenario
  const reqB = await mkRequest(r1id);                 // alert, then request is cancelled
  const reqC = await mkRequest(r1id);                 // alert, then request expires
  const reqD = await mkRequest(r1id);                 // alert, then another donor accepts it
  const reqUnverified = await mkRequest(r1id, { status: 'pending', verified: 0 });
  const reqNotCompat = await mkRequest(r1id, { bg: 'O-' }); // only O- donors may give

  await call('PATCH', '/api/donors/me/availability', dOff.token, { is_available: false });

  // ================================================== BASELINE visibility
  console.log('--- baseline visibility (no alert yet)');
  let a = await matchIds(dAlerted.token);
  check('eligible donor sees verified, open, compatible requests', a.includes(reqA) && a.includes(reqB) && a.includes(reqC) && a.includes(reqD), JSON.stringify(a));
  check('un-verified / pending request is NOT visible', !a.includes(reqUnverified), JSON.stringify(a));
  check('request needing an incompatible group (O-) is NOT visible to an O+ donor', !a.includes(reqNotCompat), JSON.stringify(a));
  check('AB+ donor sees none of the A+ requests', (await matchIds(dAB.token)).length === 0);
  check('donor inside the 3-month cooldown sees no requests', (await matchIds(dCool.token)).length === 0);
  check('donor who is unavailable sees no requests', (await matchIds(dOff.token)).length === 0);

  // ================================================== THE L-03 CORE
  console.log('--- an alert surfaces the request (does not hide it)');
  const al = await alert(R1, reqA, dAlerted.user.id);
  check('alert dispatched -> 200', al.status === 200, al.text);
  check("   ...stored as a single 'notified' row", (await rows(reqA, dAlerted.user.id)).length === 1 && (await rows(reqA, dAlerted.user.id))[0].status === 'notified');
  a = await matchIds(dAlerted.token);
  check('alerted donor STILL sees the request in their match list', a.includes(reqA), JSON.stringify(a));
  check('   ...and it is listed exactly once (no duplicate entry)', a.filter((id) => id === reqA).length === 1);
  check('a donor who was not alerted still sees it too', (await matchIds(dOther.token)).includes(reqA));

  console.log('--- no duplicate alerts');
  const dup = await alert(R1, reqA, dAlerted.user.id);
  check('second alert to the same donor for the same request -> 409', dup.status === 409 && /already been alerted/.test(dup.json?.error || ''), dup.text);
  check('   ...still exactly one row', (await rows(reqA, dAlerted.user.id)).length === 1);

  // ================================================== alerted donor can act on it
  console.log('--- alerted donor can decline: request then leaves THEIR list only');
  check('alert to the decliner -> 200', (await alert(R1, reqA, dDecline.user.id)).status === 200);
  check('alerted decliner sees the request', (await matchIds(dDecline.token)).includes(reqA));
  const dec = await call('POST', `/api/requests/${reqA}/decline`, dDecline.token, {});
  check('alerted donor declines -> 200', dec.status === 200, dec.text);
  const decRows = await rows(reqA, dDecline.user.id);
  check("   ...the same row is updated to 'declined' (no second row)", decRows.length === 1 && decRows[0].status === 'declined', JSON.stringify(decRows));
  check('declined request no longer appears for that donor', !(await matchIds(dDecline.token)).includes(reqA));
  check('declined request still appears for other donors', (await matchIds(dAlerted.token)).includes(reqA));
  const re = await alert(R1, reqA, dDecline.user.id);
  check("a decline is never undone by a new alert -> 404, row stays 'declined'", re.status === 404 && (await rows(reqA, dDecline.user.id))[0].status === 'declined', re.text);

  console.log('--- alerted donor can accept: commitment rules unchanged');
  const acc = await call('POST', `/api/requests/${reqA}/accept`, dAlerted.token, {});
  check('alerted donor accepts -> 200', acc.status === 200, acc.text);
  const accRows = await rows(reqA, dAlerted.user.id);
  check("   ...the 'notified' row becomes 'accepted' (single row)", accRows.length === 1 && accRows[0].status === 'accepted', JSON.stringify(accRows));
  check('committed donor sees no further requests', (await matchIds(dAlerted.token)).length === 0);
  check('request now donor_accepted: gone from every other donor list', !(await matchIds(dOther.token)).includes(reqA));
  const late = await alert(R1, reqA, dOther.user.id);
  check('cannot alert for a request that already has a committed donor -> 409', late.status === 409, late.text);

  // ================================================== alert never keeps a closed request visible
  console.log('--- alerted request stops being visible when it is no longer open');
  check('alert for reqB -> 200', (await alert(R1, reqB, dOther.user.id)).status === 200);
  check('alerted donor sees reqB', (await matchIds(dOther.token)).includes(reqB));
  check('requester cancels reqB', (await call('PATCH', `/api/requests/${reqB}/status`, R1, { status: 'cancelled' })).status === 200);
  check('cancelled request disappears for the alerted donor', !(await matchIds(dOther.token)).includes(reqB));

  check('alert for reqC -> 200', (await alert(R1, reqC, dOther.user.id)).status === 200);
  await db.query('UPDATE requests SET required_by = NOW() - INTERVAL 1 HOUR WHERE id = ?', [reqC]);
  check('expired request disappears for the alerted donor', !(await matchIds(dOther.token)).includes(reqC));

  console.log('--- alerted donor loses visibility if no longer eligible');
  check('alert for reqD -> 200', (await alert(R1, reqD, dOther.user.id)).status === 200);
  check('alerted donor sees reqD', (await matchIds(dOther.token)).includes(reqD));
  await call('PATCH', '/api/donors/me/availability', dOther.token, { is_available: false });
  check('alerted donor who turns availability off sees nothing', (await matchIds(dOther.token)).length === 0);
  await call('PATCH', '/api/donors/me/availability', dOther.token, { is_available: true });

  console.log('--- authorization unchanged');
  check('requester token on donor match list -> 403', (await call('GET', '/api/donors/matches', R1)).status === 403);
  check('no token on donor match list -> 401', (await call('GET', '/api/donors/matches', null)).status === 401);
} catch (e) { fail++; console.log('ERROR', e); }
finally { await db.end().catch(() => {}); srv.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
