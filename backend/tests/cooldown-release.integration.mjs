// Integration test for cooldown expiry (Phase 2, Fix 1 / audit L-01).
//
// !!! DESTRUCTIVE: this script TRUNCATES every application table. !!!
// It will only run against a disposable test database that passes every check
// in tests/helpers/destructiveTestGuard.mjs, otherwise it exits with code 2
// before changing anything. Read that file for the exact rules. In short:
//
//   cd backend
//   DB_HOST=<host> DB_PORT=4000 DB_USER=... DB_PASSWORD=... DB_NAME=blood_donor_test \
//   DB_SSL=true CONFIRM_TRUNCATE_ALL_TABLES_IN=<host>/blood_donor_test \
//     node tests/cooldown-release.integration.mjs [port]
//
// The database must already have schema.sql + migrations 001-006 applied.
//
// What it does: creates donors through the real signup API, forces each one
// into a particular state with SQL, then RESTARTS the real server
// (src/server.js). On startup the server runs its expiry sweep, which is what
// returns donors with an expired cooldown to AVAILABLE. The test then checks
// the database and the HTTP API, including that a released donor can accept an
// emergency again and one still cooling down cannot. (On Vercel the same sweep
// runs from the per-request middleware instead of at startup; both call the same
// runSweeps() function.)
import { spawn } from 'node:child_process';
import { openDisposableTestDb } from './helpers/destructiveTestGuard.mjs';

const dir = process.cwd();
const port = process.argv[2] || '5058';
const BASE = `http://127.0.0.1:${port}`;

const { db, env: baseEnv } = await openDisposableTestDb();
const env = { ...baseEnv, PORT: port };

let srv = null;
const startServer = async () => {
  srv = spawn('node', ['src/server.js'], { cwd: dir, env, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {            // wait up to ~20s for the server to accept requests
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become healthy in time');
};
const stopServer = async () => {
  if (!srv) return;
  const child = srv; srv = null;
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 3000); });
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const signup = async (o) => (await call('POST', '/api/auth/signup', null, { password: 'password123', city: 'Testville', ...o })).json;
const profile = async (userId) => (await db.query('SELECT * FROM donor_profiles WHERE user_id = ?', [userId]))[0][0];

// The server compares dates in UTC, so the test builds its dates in UTC too.
const utcDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

try {
  await startServer();

  const requester = await signup({ name: 'Requester', email: 'req@test.dev', role: 'requester', phone: '03001112223' });
  const mkDonor = (key) => signup({ name: `Donor ${key}`, email: `${key}@test.dev`, role: 'donor', blood_group: 'O+' });
  const keys = ['released', 'boundary', 'notyet', 'suspended', 'committed', 'availoff', 'nulldate', 'enroute', 'donationdone', 'verified'];
  const d = {};
  for (const k of keys) d[k] = await mkDonor(k);

  // Open, verified A+ request that compatible donors can accept, and one that
  // other donors are (artificially) committed to.
  const mkRequest = async (status) => (await db.query(
    `INSERT INTO requests (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by, status, is_verified)
     VALUES (?, 'A+', 1, 'City Hospital', 'Testville', 'high', NOW() + INTERVAL 48 HOUR, ?, 1)`,
    [requester.user.id, status]))[0].insertId;
  const openRequestId = await mkRequest('verified');
  const commitRequestId = await mkRequest('donor_accepted');

  // Force each donor into the state under test.
  const setState = (key, { status, avail, last, committed = null, verified = 0 }) => db.query(
    `UPDATE donor_profiles
        SET current_status = ?, is_available = ?, last_donation_date = ?, committed_request_id = ?,
            cooldown_until = ?, is_blood_group_verified = ?
      WHERE user_id = ?`,
    [status, avail, last, committed, last ? utcDay(0) : null, verified, d[key].user.id]);
  await setState('released',     { status: 'COOLDOWN', avail: 0, last: utcDay(-100) });                       // long expired
  await setState('boundary',     { status: 'COOLDOWN', avail: 0, last: utcDay(-90) });                        // exactly 90 days
  await setState('notyet',       { status: 'COOLDOWN', avail: 0, last: utcDay(-89) });                        // one day to go
  await setState('suspended',    { status: 'COOLDOWN', avail: 0, last: utcDay(-100) });                       // expired but suspended
  await setState('committed',    { status: 'COOLDOWN', avail: 0, last: utcDay(-100), committed: commitRequestId }); // expired but holds a commitment
  await setState('availoff',     { status: 'AVAILABLE', avail: 0, last: utcDay(-100) });                      // chose to be unavailable
  await setState('nulldate',     { status: 'COOLDOWN', avail: 0, last: null });                               // no date to prove expiry
  await setState('enroute',      { status: 'EN_ROUTE', avail: 1, last: utcDay(-100), committed: commitRequestId });
  await setState('donationdone', { status: 'DONATION_COMPLETED', avail: 1, last: utcDay(-100), committed: commitRequestId });
  await setState('verified',     { status: 'COOLDOWN', avail: 0, last: utcDay(-120), verified: 1 });          // verified blood group
  await db.query('UPDATE users SET is_suspended = 1 WHERE id = ?', [d.suspended.user.id]);

  const before = {};
  for (const k of keys) before[k] = await profile(d[k].user.id);
  check('setup: the donor who should be released starts in COOLDOWN, unavailable', before.released.current_status === 'COOLDOWN' && !before.released.is_available);

  // Before the sweep the donor really is stuck: cooldown date long past, still locked out.
  const stuck = await call('GET', '/api/donors/me', d.released.token);
  check('before the sweep: dashboard data shows cooldown over but status still COOLDOWN (the L-01 bug)',
    stuck.json?.current_status === 'COOLDOWN' && stuck.json?.cooldown_info?.isEligible === true, stuck.text.slice(0, 200));

  // Restart the real server: its startup sweep releases expired cooldowns.
  await stopServer();
  await startServer();
  let released = null;
  for (let i = 0; i < 40; i++) {            // up to ~20s for the fire-and-forget startup sweep
    released = await profile(d.released.user.id);
    if (released.current_status === 'AVAILABLE') break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---- donors that SHOULD be released -------------------------------------
  console.log('--- released');
  check('long-expired cooldown -> AVAILABLE and available again', released.current_status === 'AVAILABLE' && Boolean(released.is_available), JSON.stringify(released));
  const boundary = await profile(d.boundary.user.id);
  check('cooldown that ended exactly 90 days ago -> released', boundary.current_status === 'AVAILABLE' && Boolean(boundary.is_available), JSON.stringify(boundary));
  const verified = await profile(d.verified.user.id);
  check('donor with a verified blood group -> released, verification flag untouched', verified.current_status === 'AVAILABLE' && Boolean(verified.is_available) && Boolean(verified.is_blood_group_verified), JSON.stringify(verified));
  for (const k of ['released', 'boundary', 'verified']) {
    const now = await profile(d[k].user.id);
    check(`released donor (${k}): date, cooldown_until, blood group and commitment fields unchanged`,
      String(now.last_donation_date) === String(before[k].last_donation_date) &&
      String(now.cooldown_until) === String(before[k].cooldown_until) &&
      now.blood_group === before[k].blood_group && now.committed_request_id === before[k].committed_request_id);
  }

  // ---- donors that must NOT be touched ------------------------------------
  console.log('--- untouched');
  const untouched = async (label, k) => {
    const now = await profile(d[k].user.id);
    const same = ['current_status', 'is_available', 'last_donation_date', 'committed_request_id', 'cooldown_until', 'is_blood_group_verified']
      .every((col) => String(now[col]) === String(before[k][col]));
    check(`${label} -> left exactly as it was`, same, JSON.stringify(now));
  };
  await untouched('cooldown with one day still to go (89 days)', 'notyet');
  await untouched('expired cooldown but the account is SUSPENDED', 'suspended');
  await untouched('expired cooldown but the donor holds a commitment', 'committed');
  await untouched('donor who chose to be unavailable (not in cooldown)', 'availoff');
  await untouched('COOLDOWN with no last_donation_date', 'nulldate');
  await untouched('donor EN_ROUTE on an emergency', 'enroute');
  await untouched('donor in DONATION_COMPLETED (waiting to log the donation)', 'donationdone');

  // ---- what the donor actually experiences over HTTP ----------------------
  console.log('--- over HTTP');
  const me = await call('GET', '/api/donors/me', d.released.token);
  check('GET /api/donors/me: status AVAILABLE and available', me.status === 200 && me.json?.current_status === 'AVAILABLE' && Boolean(me.json?.is_available), me.text.slice(0, 200));
  const matches = await call('GET', '/api/donors/matches', d.released.token);
  check('GET /api/donors/matches: sees open requests again (no "currently cooldown" reason)',
    matches.status === 200 && Array.isArray(matches.json?.matches) && matches.json.matches.some((m) => m.id === openRequestId) && !matches.json?.reason, matches.text.slice(0, 200));
  // The donor still cooling down tries FIRST, while the request is still open, so a
  // refusal can only be about the donor and not about the request's state.
  const still = await call('GET', '/api/donors/matches', d.notyet.token);
  check('a donor one day short of the cooldown still sees no requests', still.status === 200 && Array.isArray(still.json?.matches) && still.json.matches.length === 0 && /cooldown/i.test(still.json?.reason || ''), still.text.slice(0, 200));
  const stillAccept = await call('POST', `/api/requests/${openRequestId}/accept`, d.notyet.token, {});
  const openAfterRefusal = (await db.query('SELECT status FROM requests WHERE id = ?', [openRequestId]))[0][0].status;
  check('...and cannot accept an open request (409), leaving it open', stillAccept.status === 409 && openAfterRefusal === 'verified', `${stillAccept.status} ${stillAccept.text.slice(0, 160)} request=${openAfterRefusal}`);
  const accept = await call('POST', `/api/requests/${openRequestId}/accept`, d.released.token, {});
  check('a released donor can accept an emergency again', accept.status === 200 && accept.json?.donor_status === 'COMMITTED', accept.text.slice(0, 200));
  const susp = await call('GET', '/api/donors/me', d.suspended.token);
  check('the suspended donor is still locked out of the API (403)', susp.status === 403, susp.text.slice(0, 200));
} catch (e) { fail++; console.log('ERROR', e); }
finally { await stopServer(); await db.end().catch(() => {}); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
