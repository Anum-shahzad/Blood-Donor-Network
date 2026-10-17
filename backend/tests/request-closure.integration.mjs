// Integration test for request closure and donor release (Phase 2, Fix 2 / audit L-02).
//
// !!! DESTRUCTIVE: this script TRUNCATES every application table. !!!
// It only runs against a disposable test database that passes every check in
// tests/destructiveTestGuard.mjs, otherwise it exits with code 2 before
// changing anything. In short:
//
//   cd backend
//   DB_HOST=<host> DB_PORT=<port> DB_USER=... DB_PASSWORD=... DB_NAME=blood_donor_test \
//   DB_SSL=true CONFIRM_TRUNCATE_ALL_TABLES_IN=<host>/blood_donor_test \
//     node tests/request-closure.integration.mjs [port]
//
// (DB_SSL=true is only needed for TLS-only hosts such as TiDB Cloud.)
// The database must already have schema.sql + migrations 001-006 applied.
//
// It starts the real server (src/server.js), creates users through the real
// signup/bootstrap APIs, forces donors and requests into particular states with
// SQL, then drives the real HTTP endpoints:
//   PATCH /api/requests/:id/status     (requester fulfils / cancels)
//   PATCH /api/admin/requests/:id/reject
// and checks the database afterwards, including concurrent races.
import { spawn } from 'node:child_process';
import { openDisposableTestDb } from './destructiveTestGuard.mjs';

const dir = process.cwd();
const port = process.argv[2] || '5059';
const BASE = `http://127.0.0.1:${port}`;

const { db, env: baseEnv } = await openDisposableTestDb();
const env = { ...baseEnv, PORT: port };

let srv = null;
const startServer = async () => {
  srv = spawn('node', ['src/server.js'], { cwd: dir, env, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
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
// DATE/DATETIME columns are also returned as plain YYYY-MM-DD strings (…_str): the
// shared test connection would otherwise hand back JS Dates shifted by the local time zone.
const donorRow = async (userId) => (await db.query(
  `SELECT dp.*, DATE_FORMAT(last_donation_date, '%Y-%m-%d') AS last_donation_date_str,
          DATE_FORMAT(cooldown_until, '%Y-%m-%d') AS cooldown_until_str
     FROM donor_profiles dp WHERE user_id = ?`, [userId]))[0][0];
const requestRow = async (id) => (await db.query('SELECT * FROM requests WHERE id = ?', [id]))[0][0];
const utcDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

let seq = 0;
try {
  await startServer();

  const adminBoot = (await call('POST', '/api/auth/bootstrap-admin', null,
    { name: 'Admin', email: 'admin@test.dev', password: 'password123', secret: 'bootstrap-test' })).json;
  const admin = adminBoot;
  const requester = await signup({ name: 'Requester', email: 'req@test.dev', role: 'requester', phone: '03001112223' });
  const otherRequester = await signup({ name: 'Other Requester', email: 'req2@test.dev', role: 'requester', phone: '03001112224' });
  check('setup: admin and requesters created', Boolean(admin?.token && requester?.token && otherRequester?.token));

  const mkRequest = async (status, { owner = requester, verified = 1 } = {}) => (await db.query(
    `INSERT INTO requests (requester_id, blood_group, units_needed, hospital_name, city, urgency, required_by, status, is_verified)
     VALUES (?, 'A+', 1, 'City Hospital', 'Testville', 'high', NOW() + INTERVAL 48 HOUR, ?, ?)`,
    [owner.user.id, status, verified]))[0].insertId;

  // Creates a donor (via the real signup API) and forces them into a state.
  const mkDonor = async ({ status = 'AVAILABLE', avail = 1, last = null, committed = null, verified = 0, suspended = false } = {}) => {
    const key = `donor${++seq}`;
    const dn = await signup({ name: `Donor ${key}`, email: `${key}@test.dev`, role: 'donor', blood_group: 'O+' });
    await db.query(
      `UPDATE donor_profiles
          SET current_status = ?, is_available = ?, last_donation_date = ?, committed_request_id = ?,
              commitment_started_at = ?, cooldown_until = NULL, is_blood_group_verified = ?
        WHERE user_id = ?`,
      [status, avail, last, committed, committed ? new Date(Date.now() - 3600000) : null, verified, dn.user.id]);
    if (suspended) await db.query('UPDATE users SET is_suspended = 1 WHERE id = ?', [dn.user.id]);
    return dn;
  };
  const requesterClose = (requestId, status, who = requester) => call('PATCH', `/api/requests/${requestId}/status`, who.token, { status });
  const adminReject = (requestId) => call('PATCH', `/api/admin/requests/${requestId}/reject`, admin.token, {});

  // =========================================================================
  console.log('--- requester closes a request: committed donor is released');
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid, verified: 1 });
    const r = await requesterClose(rid, 'cancelled');
    const d = await donorRow(dn.user.id);
    check('requester cancel -> 200, request cancelled, 1 donor released',
      r.status === 200 && r.json?.new_status === 'cancelled' && r.json?.donors_released === 1 && (await requestRow(rid)).status === 'cancelled', r.text);
    check('donor is AVAILABLE with the commitment cleared and an end time recorded',
      d.current_status === 'AVAILABLE' && d.committed_request_id === null && d.commitment_ended_at !== null, JSON.stringify(d));
    check('donor stays available (is_available kept) and keeps blood-group verification',
      Boolean(d.is_available) && Boolean(d.is_blood_group_verified), JSON.stringify(d));
  }
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', avail: 0, committed: rid });
    await requesterClose(rid, 'fulfilled');
    const d = await donorRow(dn.user.id);
    check('a donor who had set themselves unavailable stays unavailable after release (not force-enabled)',
      d.current_status === 'AVAILABLE' && !d.is_available && d.committed_request_id === null, JSON.stringify(d));
  }
  for (const state of ['MATCHED', 'COMMITTED', 'EN_ROUTE', 'ARRIVED', 'DONATING', 'DONATION_COMPLETED']) {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: state, committed: rid });
    const r = await requesterClose(rid, 'fulfilled');
    const d = await donorRow(dn.user.id);
    check(`donor in ${state} is released when the request is fulfilled`,
      r.status === 200 && r.json?.donors_released === 1 && d.current_status === 'AVAILABLE' && d.committed_request_id === null, `${r.text} ${JSON.stringify(d)}`);
  }

  // =========================================================================
  console.log('--- release respects last_donation_date and the cooldown');
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'DONATION_COMPLETED', committed: rid, last: utcDay(-30) });
    const r = await requesterClose(rid, 'cancelled');
    const d = await donorRow(dn.user.id);
    check('donated 30 days ago -> COOLDOWN (not AVAILABLE), unavailable, cooldown_until = +60 days',
      r.status === 200 && d.current_status === 'COOLDOWN' && !d.is_available && d.cooldown_until_str === utcDay(60) && d.committed_request_id === null,
      `${r.text} ${JSON.stringify(d)}`);
    check('last_donation_date is untouched by the release', d.last_donation_date_str === utcDay(-30), JSON.stringify(d));
  }
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid, last: utcDay(-100) });
    await requesterClose(rid, 'cancelled');
    const d = await donorRow(dn.user.id);
    check('donated 100 days ago (cooldown over) -> AVAILABLE', d.current_status === 'AVAILABLE' && Boolean(d.is_available), JSON.stringify(d));
  }
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid, last: utcDay(-89) });
    await requesterClose(rid, 'cancelled');
    check('donated 89 days ago (one day short) -> COOLDOWN', (await donorRow(dn.user.id)).current_status === 'COOLDOWN');
  }
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid, last: utcDay(-90) });
    await requesterClose(rid, 'cancelled');
    check('donated exactly 90 days ago -> AVAILABLE', (await donorRow(dn.user.id)).current_status === 'AVAILABLE');
  }

  // =========================================================================
  console.log('--- other data is preserved');
  {
    const rid = await mkRequest('donor_accepted');
    const otherRid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid, verified: 1, suspended: true });
    const bystander = await mkDonor({ status: 'COMMITTED', committed: otherRid });
    const idle = await mkDonor({ status: 'AVAILABLE' });
    await db.query(`INSERT INTO donations (donor_id, request_id, donation_date, hospital_name, units, blood_group, is_verified)
                    VALUES (?, NULL, ?, 'Old Hospital', 1, 'O+', 0)`, [dn.user.id, utcDay(-200)]);
    const beforeBystander = await donorRow(bystander.user.id);
    const beforeIdle = await donorRow(idle.user.id);
    const beforeOther = await requestRow(otherRid);
    const r = await adminReject(rid);
    const d = await donorRow(dn.user.id);
    const donations = (await db.query('SELECT COUNT(*) AS n FROM donations WHERE donor_id = ?', [dn.user.id]))[0][0].n;
    const suspended = (await db.query('SELECT is_suspended FROM users WHERE id = ?', [dn.user.id]))[0][0].is_suspended;
    check('suspended donor is released but stays suspended; verification and donation history untouched',
      r.status === 200 && d.current_status === 'AVAILABLE' && Boolean(suspended) && Boolean(d.is_blood_group_verified) && Number(donations) === 1, `${r.text} ${JSON.stringify(d)}`);
    const afterBystander = await donorRow(bystander.user.id);
    const afterIdle = await donorRow(idle.user.id);
    const afterOther = await requestRow(otherRid);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('a donor committed to a DIFFERENT request is not touched', same(beforeBystander, afterBystander), JSON.stringify(afterBystander));
    check('an unrelated available donor is not touched', same(beforeIdle, afterIdle));
    check('an unrelated request is not touched', same(beforeOther, afterOther));
  }

  // =========================================================================
  console.log('--- admin rejection');
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'EN_ROUTE', committed: rid });
    const r = await adminReject(rid);
    const row = await requestRow(rid);
    const d = await donorRow(dn.user.id);
    check('admin reject -> 200, request cancelled and un-verified, donor released',
      r.status === 200 && r.json?.donors_released === 1 && r.json?.already_closed === false && row.status === 'cancelled' && !row.is_verified &&
      d.current_status === 'AVAILABLE' && d.committed_request_id === null, `${r.text} ${JSON.stringify(d)}`);
    const again = await adminReject(rid);
    check('rejecting the same request again is a safe no-op (200, already_closed, 0 released)',
      again.status === 200 && again.json?.already_closed === true && again.json?.donors_released === 0 && (await requestRow(rid)).status === 'cancelled', again.text);
  }
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid, last: utcDay(-10) });
    await adminReject(rid);
    const d = await donorRow(dn.user.id);
    check('admin reject releases a donor still in cooldown to COOLDOWN, not AVAILABLE',
      d.current_status === 'COOLDOWN' && !d.is_available && d.committed_request_id === null, JSON.stringify(d));
  }
  for (const status of ['pending', 'verified', 'matched']) {
    const rid = await mkRequest(status, { verified: status === 'pending' ? 0 : 1 });
    const r = await adminReject(rid);
    check(`admin can reject a ${status} request with no donors (0 released)`,
      r.status === 200 && r.json?.donors_released === 0 && (await requestRow(rid)).status === 'cancelled', r.text);
  }
  {
    const rid = await mkRequest('fulfilled');
    const before = await requestRow(rid);
    const r = await adminReject(rid);
    const after = await requestRow(rid);
    check('admin cannot reject a FULFILLED request (409); status and verification unchanged',
      r.status === 409 && after.status === 'fulfilled' && Boolean(after.is_verified) && JSON.stringify(before) === JSON.stringify(after), r.text);
  }
  {
    const rid = await mkRequest('expired');
    const r = await adminReject(rid);
    check('admin cannot reject an EXPIRED request (409); status unchanged', r.status === 409 && (await requestRow(rid)).status === 'expired', r.text);
  }
  {
    const rid = await mkRequest('verified');
    await requesterClose(rid, 'cancelled');             // requester cancels first, is_verified stays 1
    const before = await requestRow(rid);
    const r = await adminReject(rid);
    const after = await requestRow(rid);
    check('admin reject of an already-cancelled request does not rewrite it (still verified flag as it was)',
      r.status === 200 && r.json?.already_closed === true && JSON.stringify(before) === JSON.stringify(after), r.text);
  }
  {
    const missing = await adminReject(999999);
    check('admin reject of a missing request -> 404', missing.status === 404, missing.text);
    const bad = await call('PATCH', '/api/admin/requests/abc/reject', admin.token, {});
    check('admin reject with an invalid id -> 400', bad.status === 400, bad.text);
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid });
    const nonAdmin = await call('PATCH', `/api/admin/requests/${rid}/reject`, requester.token, {});
    check('a non-admin cannot reject (403) and nothing changes',
      nonAdmin.status === 403 && (await requestRow(rid)).status === 'donor_accepted' && (await donorRow(dn.user.id)).committed_request_id === rid, nonAdmin.text);
  }

  // =========================================================================
  console.log('--- requester status guards and repeats');
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid });
    await requesterClose(rid, 'cancelled');
    const again = await requesterClose(rid, 'cancelled');
    check('cancelling an already-cancelled request is a safe no-op (200, already_closed, 0 released)',
      again.status === 200 && again.json?.already_closed === true && again.json?.donors_released === 0 && (await requestRow(rid)).status === 'cancelled', again.text);
    const flip = await requesterClose(rid, 'fulfilled');
    check('a cancelled request cannot be marked fulfilled (409)', flip.status === 409 && (await requestRow(rid)).status === 'cancelled', flip.text);
    check('the donor stays released across the repeats', (await donorRow(dn.user.id)).current_status === 'AVAILABLE');
  }
  {
    const rid = await mkRequest('fulfilled');
    const r = await requesterClose(rid, 'cancelled');
    check('a fulfilled request cannot be cancelled by the requester (409), history kept', r.status === 409 && (await requestRow(rid)).status === 'fulfilled', r.text);
    const same = await requesterClose(rid, 'fulfilled');
    check('marking a fulfilled request fulfilled again is a safe no-op', same.status === 200 && same.json?.already_closed === true, same.text);
  }
  {
    const rid = await mkRequest('expired');
    const r = await requesterClose(rid, 'cancelled');
    check('an expired request cannot be cancelled or rewritten (409)', r.status === 409 && (await requestRow(rid)).status === 'expired', r.text);
  }
  {
    const rid = await mkRequest('donor_accepted');
    const dn = await mkDonor({ status: 'COMMITTED', committed: rid });
    const r = await requesterClose(rid, 'cancelled', otherRequester);
    check("another requester cannot close someone else's request (404); donor stays committed",
      r.status === 404 && (await requestRow(rid)).status === 'donor_accepted' && (await donorRow(dn.user.id)).committed_request_id === rid, r.text);
    const bad = await requesterClose(rid, 'pending');
    check('an invalid target status is refused (400)', bad.status === 400 && (await requestRow(rid)).status === 'donor_accepted', bad.text);
  }

  // =========================================================================
  console.log('--- repeating a close frees a donor stranded on an already-closed request');
  {
    const rid = await mkRequest('cancelled');
    const dn = await mkDonor({ status: 'DONATION_COMPLETED', committed: rid });   // left behind by older code
    const r = await requesterClose(rid, 'cancelled');
    const d = await donorRow(dn.user.id);
    check('stranded donor released by a repeated cancel (request itself unchanged)',
      r.status === 200 && r.json?.already_closed === true && r.json?.donors_released === 1 && d.current_status === 'AVAILABLE' && d.committed_request_id === null,
      `${r.text} ${JSON.stringify(d)}`);
  }

  // =========================================================================
  console.log('--- concurrency');
  {
    // Requester and admin close the same request at the same instant.
    let bad = 0, released = 0;
    for (let i = 0; i < 10; i++) {
      const rid = await mkRequest('donor_accepted');
      const dn = await mkDonor({ status: 'COMMITTED', committed: rid });
      const [a, b] = await Promise.all([requesterClose(rid, 'cancelled'), adminReject(rid)]);
      released += (a.json?.donors_released || 0) + (b.json?.donors_released || 0);
      const d = await donorRow(dn.user.id);
      if (a.status !== 200 || b.status !== 200 || (await requestRow(rid)).status !== 'cancelled' || d.committed_request_id !== null || d.current_status !== 'AVAILABLE') bad++;
    }
    check('10 simultaneous requester-cancel + admin-reject pairs: always 200/200, cancelled, donor released exactly once each', bad === 0 && released === 10, `bad=${bad} released=${released}`);
  }
  {
    // Donor backs out at the same instant the requester cancels (lock-order check).
    let bad = 0, serverErrors = 0;
    for (let i = 0; i < 15; i++) {
      const rid = await mkRequest('donor_accepted');
      const dn = await mkDonor({ status: 'COMMITTED', committed: rid });
      const [a, b] = await Promise.all([
        requesterClose(rid, 'cancelled'),
        call('POST', '/api/donors/me/commitment/cancel', dn.token, {}),
      ]);
      if (a.status >= 500 || b.status >= 500) serverErrors++;
      const d = await donorRow(dn.user.id);
      if ((await requestRow(rid)).status !== 'cancelled' || d.committed_request_id !== null || d.current_status !== 'AVAILABLE') bad++;
    }
    check('15 simultaneous requester-cancel + donor-cancel pairs: no 5xx/deadlock, request cancelled, donor free', bad === 0 && serverErrors === 0, `bad=${bad} serverErrors=${serverErrors}`);
  }
  {
    // A donor accepts at the same instant the requester cancels: nobody may be left committed to a closed request.
    let bad = 0, serverErrors = 0;
    for (let i = 0; i < 15; i++) {
      const rid = await mkRequest('verified');
      const dn = await mkDonor({ status: 'AVAILABLE' });
      const [a, b] = await Promise.all([
        requesterClose(rid, 'cancelled'),
        call('POST', `/api/requests/${rid}/accept`, dn.token, {}),
      ]);
      if (a.status >= 500 || b.status >= 500) serverErrors++;
      const d = await donorRow(dn.user.id);
      if ((await requestRow(rid)).status !== 'cancelled' || d.committed_request_id !== null || d.current_status !== 'AVAILABLE') bad++;
    }
    check('15 simultaneous donor-accept + requester-cancel pairs: no 5xx, request cancelled, no donor stranded', bad === 0 && serverErrors === 0, `bad=${bad} serverErrors=${serverErrors}`);
  }
  {
    // Final invariant across the whole run: nobody is committed to a closed request.
    const [rows] = await db.query(
      `SELECT dp.user_id FROM donor_profiles dp JOIN requests r ON r.id = dp.committed_request_id
        WHERE r.status IN ('fulfilled', 'cancelled', 'expired')`);
    check('invariant: no donor is committed to a fulfilled/cancelled/expired request', rows.length === 0, JSON.stringify(rows));
  }
} catch (e) { fail++; console.log('ERROR', e); }
finally { await stopServer(); await db.end().catch(() => {}); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
