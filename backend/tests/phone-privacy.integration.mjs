// Integration test for the requester-phone privacy fix (Phase 1, Fix 1).
//
// Run from the backend/ folder against a DISPOSABLE test database that already
// has schema.sql + migrations 001-004 applied. ALL TABLES ARE EMPTIED.
//
//   DB_HOST=127.0.0.1 DB_USER=... DB_PASSWORD=... DB_NAME=blood_donor_test \
//     node tests/phone-privacy.integration.mjs [port]
//
// It refuses to run unless DB_NAME contains "test". It starts the real server
// (src/server.js) as a child process and talks to it over HTTP.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const dir = process.cwd();
const port = process.argv[2] || '5055';
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
await db.end();
const srv = spawn('node', ['src/server.js'], { cwd: dir, env, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {            // wait up to ~20s for the server to accept requests
  try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const ACCT_PHONE = '03001112223';      // requester's account phone
const REQ_PHONE = '03214445556';       // phone typed on the blood request
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const leaks = (text) => /0300111|1112223|0321444|4445556|contact_phone|requester_phone|requester_email|requester1@/i.test(text);
const signup = async (o) => (await call('POST', '/api/auth/signup', null, { password: 'password123', city: 'Testville', ...o })).json.token;

try {
  const admin = (await call('POST', '/api/auth/bootstrap-admin', null, { name: 'Admin', email: 'admin@test.dev', password: 'password123', secret: 'bootstrap-test' })).json.token;
  const R = await signup({ name: 'Req One', email: 'requester1@test.dev', role: 'requester', phone: ACCT_PHONE });
  const R2 = await signup({ name: 'Req Two', email: 'requester2@test.dev', role: 'requester', phone: '03009990000' });
  const A = await signup({ name: 'Donor A', email: 'a@test.dev', role: 'donor', blood_group: 'O+' });   // compatible, will accept
  const B = await signup({ name: 'Donor B', email: 'b@test.dev', role: 'donor', blood_group: 'A-' });   // compatible, unaffiliated
  const C = await signup({ name: 'Donor C', email: 'c@test.dev', role: 'donor', blood_group: 'AB+' });  // NOT compatible with A+

  const created = await call('POST', '/api/requests', R, { blood_group: 'A+', units_needed: 2, hospital_name: 'City Hospital', city: 'Testville', urgency: 'high', contact_phone: REQ_PHONE, attendant_name: 'Attendant', patient_case: 'surgery' });
  const rid = created.json.id;
  await call('PATCH', `/api/admin/requests/${rid}/verify`, admin, { verified: true });

  // ---- BEFORE acceptance
  const noAuthMatches = await call('GET', '/api/donors/matches');
  check('unauthenticated GET /donors/matches -> 401, no phone', noAuthMatches.status === 401 && !leaks(noAuthMatches.text));
  const noAuthMe = await call('GET', '/api/donors/me');
  check('unauthenticated GET /donors/me -> 401, no phone', noAuthMe.status === 401 && !leaks(noAuthMe.text));
  const reqRoleMatches = await call('GET', '/api/donors/matches', R);
  check('requester token on donor endpoint -> 403', reqRoleMatches.status === 403);

  for (const [label, tok] of [['donor A', A], ['donor B (unaffiliated)', B]]) {
    const m = await call('GET', '/api/donors/matches', tok);
    const listed = m.json?.matches?.some((x) => x.id === rid);
    check(`${label}: request still listed in /matches (matching works)`, m.status === 200 && listed);
    check(`${label}: /matches body has no requester phone/email fields or values`, !leaks(m.text), m.text.slice(0, 300));
    const me = await call('GET', '/api/donors/me', tok);
    check(`${label}: /me before acceptance has no phone`, me.status === 200 && me.json.committed_request === null && !leaks(me.text));
  }
  const cm = await call('GET', '/api/donors/matches', C);
  check('donor C (incompatible): request not listed', !cm.json.matches.some((x) => x.id === rid));
  const cAccept = await call('POST', `/api/requests/${rid}/accept`, C);
  check('donor C cannot accept incompatible request (409), no phone', cAccept.status === 409 && !leaks(cAccept.text));

  // ID manipulation / direct calls by an unaffiliated donor
  const probes = [
    ['GET', `/api/conversations/${rid}`], ['GET', `/api/conversations/${rid + 1}`], ['GET', `/api/conversations/1/messages`],
    ['GET', `/api/requests/${rid}/matches`], ['POST', `/api/requests/${rid}/alert/1`], ['GET', '/api/requests/mine'],
    ['GET', `/api/admin/requests`], ['GET', '/api/public/emergencies'],
  ];
  let probeLeak = false, detail = '';
  for (const [meth, p] of probes) { const r = await call(meth, p, B); if (leaks(r.text)) { probeLeak = true; detail += `${meth} ${p} `; } }
  check('donor B probing other endpoints / changed IDs never receives a phone', !probeLeak, detail);

  // ---- Donor A accepts
  const acc = await call('POST', `/api/requests/${rid}/accept`, A);
  check('donor A accepts request (acceptance works)', acc.status === 200 && acc.json.request_status === 'donor_accepted', acc.text);

  const meA = await call('GET', '/api/donors/me', A);
  check('accepted donor A gets the request contact_phone (existing workflow preserved)', meA.json?.committed_request?.contact_phone === REQ_PHONE, meA.text.slice(0, 400));
  check('accepted donor A does NOT get requester account phone or email', !/1112223|requester1@|requester_phone|requester_email/.test(meA.text), meA.text.slice(0, 400));

  const meB = await call('GET', '/api/donors/me', B);
  check('donor B (not the accepted donor): /me has no phone', !leaks(meB.text) && meB.json.committed_request === null);
  const mB = await call('GET', '/api/donors/matches', B);
  check('donor B: /matches after acceptance has no phone', mB.status === 200 && !leaks(mB.text));
  const bAccept = await call('POST', `/api/requests/${rid}/accept`, B);
  check('donor B cannot accept an already-accepted request (409), no phone', bAccept.status === 409 && !leaks(bAccept.text));

  // ---- Chat still works, and only participants can use it
  const conv = await call('GET', `/api/conversations/${rid}`, A);
  check('chat: donor A opens conversation', conv.status === 200 && conv.json.chat_open === true && !leaks(conv.text));
  const send = await call('POST', `/api/conversations/${conv.json.id}/messages`, A, { message: 'On my way' });
  check('chat: donor A sends message', send.status === 201);
  const convR = await call('GET', `/api/conversations/${rid}`, R);
  const listR = await call('GET', `/api/conversations/${convR.json.id}/messages`, R);
  check('chat: requester reads message', listR.status === 200 && listR.json.messages.some((m) => m.message === 'On my way'));
  check('chat: donor B blocked (404)', (await call('GET', `/api/conversations/${rid}`, B)).status === 404 && (await call('GET', `/api/conversations/${conv.json.id}/messages`, B)).status === 404);
  check('chat: other requester blocked (404)', (await call('GET', `/api/conversations/${rid}`, R2)).status === 404);
  check('chat: unauthenticated blocked (401)', (await call('GET', `/api/conversations/${rid}`)).status === 401);

  // ---- Requester still sees own data
  const mine = await call('GET', '/api/requests/mine', R);
  check('requester sees own request incl. own contact_phone', mine.json[0]?.contact_phone === REQ_PHONE);
  const mine2 = await call('GET', '/api/requests/mine', R2);
  check("other requester doesn't see this request/phone", mine2.status === 200 && !leaks(mine2.text));

  // ---- Request leaves 'donor_accepted' (admin reject): number must stop being shared
  await call('PATCH', `/api/admin/requests/${rid}/reject`, admin, {});
  const meA2 = await call('GET', '/api/donors/me', A);
  check('after request is cancelled, committed donor no longer receives the phone', meA2.json?.committed_request?.contact_phone == null && !/0321444|4445556|1112223|requester_phone|requester_email/.test(meA2.text), meA2.text.slice(0, 300));
} catch (e) { fail++; console.log('ERROR', e); }
finally { srv.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
