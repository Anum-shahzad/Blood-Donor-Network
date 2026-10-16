// Integration test for suspended-account enforcement (Phase 1, Fix 2).
//
// Run from the backend/ folder against a DISPOSABLE test database that already
// has schema.sql + migrations 001-004 applied. ALL TABLES ARE EMPTIED.
//
//   DB_HOST=127.0.0.1 DB_USER=... DB_PASSWORD=... DB_NAME=blood_donor_test \
//     node tests/suspension.integration.mjs [port]
//
// It refuses to run unless DB_NAME contains "test". It starts the real server
// (src/server.js) as a child process and talks to it over HTTP, so it exercises
// the real middleware, routes and database. Same conventions as
// tests/phone-privacy.integration.mjs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const dir = process.cwd();
const port = process.argv[2] || '5056';
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
const login = (email, password = 'password123') => call('POST', '/api/auth/login', null, { email, password });
const isSuspendedDenial = (r) => r.status === 403 && r.json?.code === 'ACCOUNT_SUSPENDED' && /suspended/i.test(r.json?.error || '');
const setSuspended = (admin, id, v) => call('PATCH', `/api/admin/donors/${id}/status`, admin, { is_suspended: v });

try {
  const adminRes = await call('POST', '/api/auth/bootstrap-admin', null, { name: 'Admin', email: 'admin@test.dev', password: 'password123', secret: 'bootstrap-test' });
  const admin = adminRes.json.token, adminId = adminRes.json.user.id;

  const dS = await signup({ name: 'Donor S', email: 'donor-s@test.dev', role: 'donor', blood_group: 'O+' });      // will be suspended
  const dK = await signup({ name: 'Donor K', email: 'donor-k@test.dev', role: 'donor', blood_group: 'O-' });      // bystander, never suspended
  const rS = await signup({ name: 'Req S', email: 'req-s@test.dev', role: 'requester', phone: '03001112223' });   // will be suspended
  const rK = await signup({ name: 'Req K', email: 'req-k@test.dev', role: 'requester', phone: '03009990000' });   // bystander
  const [DS, DK, RS, RK] = [dS.token, dK.token, rS.token, rK.token];
  const [dSid, dKid, rSid, rKid] = [dS.user.id, dK.user.id, rS.user.id, rK.user.id];

  // A verified, open request from the bystander requester, so donor features have something to work on.
  const mk = async (tok) => (await call('POST', '/api/requests', tok, { blood_group: 'A+', units_needed: 1, hospital_name: 'City Hospital', city: 'Testville', urgency: 'high', contact_phone: '03214445556', attendant_name: 'Att', patient_case: 'surgery' })).json.id;
  const openReq = await mk(RK);
  await call('PATCH', `/api/admin/requests/${openReq}/verify`, admin, { verified: true });
  const ownReqS = await mk(RS);   // a request owned by the requester who will be suspended

  // =========================================================== ACTIVE ACCOUNTS WORK
  console.log('--- active accounts');
  check('active donor: GET /donors/me -> 200', (await call('GET', '/api/donors/me', DS)).status === 200);
  const mA = await call('GET', '/api/donors/matches', DS);
  check('active donor: GET /donors/matches -> 200 and lists the open request', mA.status === 200 && mA.json.matches.some((x) => x.id === openReq));
  check('active donor: PATCH /donors/me/availability -> 200', (await call('PATCH', '/api/donors/me/availability', DS, { is_available: true })).status === 200);
  check('active donor: PATCH /donors/me/settings -> 200', (await call('PATCH', '/api/donors/me/settings', DS, { alert_radius: 12 })).status === 200);
  check('active donor: GET /donors/me/donations -> 200', (await call('GET', '/api/donors/me/donations', DS)).status === 200);
  check('active requester: GET /requests/mine -> 200', (await call('GET', '/api/requests/mine', RS)).status === 200);
  check('active requester: GET /requests/:id/matches -> 200', (await call('GET', `/api/requests/${ownReqS}/matches`, RS)).status === 200);
  check('active requester: POST /requests worked above (created own request)', Number.isInteger(ownReqS));
  const rsMatches = await call('GET', `/api/requests/${ownReqS}/matches`, RS);
  check('active requester sees donor S in match list (baseline for later hiding)', rsMatches.json.matches.some((m) => m.donor_id === dSid));

  // =========================================================== ADMIN ENDPOINT PROTECTION
  console.log('--- admin endpoint authorization');
  check('no token -> 401 on admin status endpoint', (await call('PATCH', `/api/admin/donors/${dSid}/status`, null, { is_suspended: true })).status === 401);
  check('donor token -> 403 on admin status endpoint', (await setSuspended(DK, dSid, true)).status === 403);
  check('requester token -> 403 on admin status endpoint', (await setSuspended(RK, dSid, true)).status === 403);
  check('donor token -> 403 on GET /admin/donors', (await call('GET', '/api/admin/donors', DK)).status === 403);
  check('a failed unauthorized attempt did NOT suspend anyone', (await call('GET', '/api/donors/me', DS)).status === 200);

  // =========================================================== SUSPEND A DONOR (old token still in hand)
  console.log('--- suspended donor (reusing a token issued before the suspension)');
  const sus1 = await setSuspended(admin, dSid, true);
  check('admin suspends donor -> 200 {is_suspended:true}', sus1.status === 200 && sus1.json.is_suspended === true, sus1.text);

  const donorProbes = [
    ['GET', '/api/donors/me'], ['GET', '/api/donors/matches'], ['GET', '/api/donors/me/donations'],
    ['POST', '/api/donors/me/donations', { donation_date: '2020-01-01', hospital_name: 'X' }],
    ['PATCH', '/api/donors/me/availability', { is_available: false }], ['PATCH', '/api/donors/me/settings', { alert_radius: 5 }],
    ['PUT', '/api/donors/me', { blood_group: 'O+' }], ['PATCH', '/api/donors/me/commitment/step', { step: 'EN_ROUTE' }],
    ['POST', '/api/donors/me/commitment/cancel', {}],
    ['POST', `/api/requests/${openReq}/accept`, {}], ['POST', `/api/requests/${openReq}/decline`, {}],
    ['GET', `/api/conversations/${openReq}`], ['GET', '/api/conversations/1/messages'], ['POST', '/api/conversations/1/messages', { message: 'hi' }],
    ['GET', '/api/requests/mine'], ['GET', '/api/admin/analytics'],
  ];
  for (const [m, p, b] of donorProbes) {
    const r = await call(m, p, DS, b);
    check(`suspended donor old token: ${m} ${p} -> 403 ACCOUNT_SUSPENDED`, isSuspendedDenial(r), `${r.status} ${r.text.slice(0, 120)}`);
  }
  const noStateChange = await db.query('SELECT is_available, alert_radius FROM donor_profiles WHERE user_id = ?', [dSid]);
  check('suspended donor writes were blocked before touching data (availability/settings unchanged)',
    noStateChange[0][0].is_available === 1 && Number(noStateChange[0][0].alert_radius) === 12, JSON.stringify(noStateChange[0][0]));

  const dLogin = await login('donor-s@test.dev');
  check('suspended donor cannot log in -> 403 ACCOUNT_SUSPENDED', isSuspendedDenial(dLogin), dLogin.text);
  const wrongPw = await login('donor-s@test.dev', 'wrong-password');
  check('wrong password on suspended account -> still 401 (suspension not revealed without the password)', wrongPw.status === 401 && !wrongPw.json?.code, wrongPw.text);
  check('error body has a message the frontend can show', typeof dLogin.json?.error === 'string' && dLogin.json.error.length > 10);

  // Other users unaffected; public routes still public.
  console.log('--- bystanders and public routes');
  check('bystander donor still works', (await call('GET', '/api/donors/me', DK)).status === 200);
  check('bystander requester still works', (await call('GET', '/api/requests/mine', RK)).status === 200);
  check('public GET /api/public/emergencies -> 200 (no token)', (await call('GET', '/api/public/emergencies')).status === 200);
  check('public GET /api/public/emergencies -> 200 even with a suspended user\'s token header', (await call('GET', '/api/public/emergencies', DS)).status === 200);
  check('GET /api/health -> 200', (await call('GET', '/api/health')).status === 200);
  check('signup of a new account still works', (await signup({ name: 'New', email: 'new@test.dev', role: 'donor', blood_group: 'B+' })).token != null);

  // =========================================================== REQUESTER-FACING MATCHING HIDES SUSPENDED DONORS
  console.log('--- suspended donor hidden from requesters');
  const m2 = await call('GET', `/api/requests/${openReq}/matches`, RK);
  check('requester match list no longer includes suspended donor S', m2.status === 200 && !m2.json.matches.some((m) => m.donor_id === dSid));
  check('requester match list still includes active donor K', m2.json.matches.some((m) => m.donor_id === dKid));
  const alertSus = await call('POST', `/api/requests/${openReq}/alert/${dSid}`, RK);
  check('requester cannot alert a suspended donor (404)', alertSus.status === 404, alertSus.text);
  const alertOk = await call('POST', `/api/requests/${openReq}/alert/${dKid}`, RK);
  check('requester can still alert an active donor (200)', alertOk.status === 200, alertOk.text);
  const rr = await db.query('SELECT COUNT(*) AS n FROM request_responses WHERE donor_id = ?', [dSid]);
  check('no alert row was created for the suspended donor', Number(rr[0][0].n) === 0);

  // =========================================================== RECORDS NOT ALTERED / DELETED
  console.log('--- suspension keeps the records');
  const rec = await db.query('SELECT u.email, u.is_suspended, dp.blood_group FROM users u JOIN donor_profiles dp ON dp.user_id = u.id WHERE u.id = ?', [dSid]);
  check('suspended donor account and profile still exist, only the flag is set', rec[0].length === 1 && rec[0][0].email === 'donor-s@test.dev' && rec[0][0].is_suspended === 1 && rec[0][0].blood_group === 'O+');

  // =========================================================== REACTIVATE DONOR
  console.log('--- reactivated donor');
  const react1 = await setSuspended(admin, dSid, false);
  check('admin reactivates donor -> 200 {is_suspended:false}', react1.status === 200 && react1.json.is_suspended === false, react1.text);
  check('reactivated donor: the SAME old token works again (/donors/me)', (await call('GET', '/api/donors/me', DS)).status === 200);
  check('reactivated donor: /donors/matches works', (await call('GET', '/api/donors/matches', DS)).status === 200);
  check('reactivated donor: availability toggle works', (await call('PATCH', '/api/donors/me/availability', DS, { is_available: true })).status === 200);
  check('reactivated donor: can log in again', (await login('donor-s@test.dev')).status === 200);
  check('reactivated donor: role rules intact (admin route still 403, not suspended)', (await call('GET', '/api/admin/donors', DS)).status === 403 && !(await call('GET', '/api/admin/donors', DS)).json?.code);
  const m3 = await call('GET', `/api/requests/${openReq}/matches`, RK);
  check('reactivated donor reappears in requester match list', m3.json.matches.some((m) => m.donor_id === dSid));
  const accept = await call('POST', `/api/requests/${openReq}/accept`, DS);
  check('reactivated donor can accept a request again (existing workflow)', accept.status === 200 && accept.json.request_status === 'donor_accepted', accept.text);

  // =========================================================== SUSPEND A REQUESTER (old token still in hand)
  console.log('--- suspended requester (reusing a token issued before the suspension)');
  const sus2 = await setSuspended(admin, rSid, true);
  check('admin suspends requester -> 200', sus2.status === 200 && sus2.json.is_suspended === true, sus2.text);
  const reqProbes = [
    ['GET', '/api/requests/mine'], ['GET', '/api/requests/archive'],
    ['POST', '/api/requests', { blood_group: 'A+', units_needed: 1, hospital_name: 'H', city: 'Testville', urgency: 'low', contact_phone: '03214445556', attendant_name: 'A', patient_case: 'x' }],
    ['PATCH', `/api/requests/${ownReqS}/status`, { status: 'cancelled' }],
    ['GET', `/api/requests/${ownReqS}/matches`], ['POST', `/api/requests/${ownReqS}/alert/${dKid}`, {}],
    ['GET', `/api/conversations/${openReq}`], ['GET', '/api/admin/requests'], ['GET', '/api/donors/me'],
  ];
  for (const [m, p, b] of reqProbes) {
    const r = await call(m, p, RS, b);
    check(`suspended requester old token: ${m} ${p.replace(/\/\d+/g, '/:id')} -> 403 ACCOUNT_SUSPENDED`, isSuspendedDenial(r), `${r.status} ${r.text.slice(0, 120)}`);
  }
  const ownStatus = await db.query('SELECT status FROM requests WHERE id = ?', [ownReqS]);
  check('suspended requester could not cancel own request (data untouched)', ownStatus[0][0].status === 'pending', JSON.stringify(ownStatus[0]));
  const rLogin = await login('req-s@test.dev');
  check('suspended requester cannot log in -> 403 ACCOUNT_SUSPENDED', isSuspendedDenial(rLogin), rLogin.text);
  check('bystander requester unaffected while another requester is suspended', (await call('GET', '/api/requests/mine', RK)).status === 200);
  const recR = await db.query('SELECT COUNT(*) AS n FROM requests WHERE requester_id = ?', [rSid]);
  check('suspended requester\'s requests were kept (not deleted)', Number(recR[0][0].n) === 1);

  console.log('--- reactivated requester');
  check('admin reactivates requester -> 200', (await setSuspended(admin, rSid, false)).status === 200);
  check('reactivated requester: same old token works (/requests/mine)', (await call('GET', '/api/requests/mine', RS)).status === 200);
  check('reactivated requester: can create a request again', (await mk(RS)) != null);
  check('reactivated requester: can log in again', (await login('req-s@test.dev')).status === 200);
  check('reactivated requester: role rules intact (donor route 403, not suspended)', (await call('GET', '/api/donors/me', RS)).status === 403 && !(await call('GET', '/api/donors/me', RS)).json?.code);

  // =========================================================== ADMIN SAFETY
  console.log('--- administrator safety');
  const susAdmin = await setSuspended(admin, adminId, true);
  check('admin cannot suspend an admin account (403)', susAdmin.status === 403, susAdmin.text);
  check('admin still has access after that attempt', (await call('GET', '/api/admin/donors', admin)).status === 200);
  await db.query('UPDATE users SET is_suspended = 1 WHERE id = ?', [adminId]);   // simulate a flag set by hand in the DB
  check('even with is_suspended=1 set directly in the DB, admin is not locked out (token)', (await call('GET', '/api/admin/donors', admin)).status === 200);
  check('even with is_suspended=1 set directly in the DB, admin is not locked out (login)', (await login('admin@test.dev')).status === 200);
  await db.query('UPDATE users SET is_suspended = 0 WHERE id = ?', [adminId]);
  check('status endpoint: unknown user id -> 404', (await setSuspended(admin, 999999, true)).status === 404);
  check('status endpoint: non-numeric id -> 400', (await call('PATCH', '/api/admin/donors/abc/status', admin, { is_suspended: true })).status === 400);
  check('status endpoint: non-boolean body -> 400', (await call('PATCH', `/api/admin/donors/${dKid}/status`, admin, { is_suspended: 'yes' })).status === 400);

  // =========================================================== AUTH BEHAVIOUR PRESERVED
  console.log('--- authentication behaviour preserved');
  check('no Authorization header -> 401', (await call('GET', '/api/donors/me')).status === 401);
  check('garbage token -> 401', (await call('GET', '/api/donors/me', 'not.a.jwt')).status === 401);
  check('wrong credentials -> 401', (await login('donor-k@test.dev', 'nope')).status === 401);
  check('unknown email -> 401', (await login('ghost@test.dev')).status === 401);
  const fresh = await login('donor-k@test.dev');
  check('login returns token + user for an active account', fresh.status === 200 && !!fresh.json.token && fresh.json.user.role === 'donor');
  check('fresh login token works', (await call('GET', '/api/donors/me', fresh.json.token)).status === 200);
  check('requester token on donor endpoint -> 403 (role check intact)', (await call('GET', '/api/donors/me', RK)).status === 403);
  check('donor token on requester endpoint -> 403 (role check intact)', (await call('GET', '/api/requests/mine', DK)).status === 403);

  // A token for an account that has since been deleted must not be accepted.
  const ghost = await signup({ name: 'Ghost', email: 'ghost2@test.dev', role: 'requester', phone: '03000000000' });
  await db.query('DELETE FROM users WHERE id = ?', [ghost.user.id]);
  check('valid token for a deleted account -> 401', (await call('GET', '/api/requests/mine', ghost.token)).status === 401);
} catch (e) { fail++; console.log('ERROR', e); }
finally { await db.end().catch(() => {}); srv.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
