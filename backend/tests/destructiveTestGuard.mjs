// Safety guard shared by integration tests that EMPTY THE DATABASE.
//
// !!! Every test that imports this TRUNCATES all application tables. !!!
// Never point one at production or at a database that holds real data.
//
// openDisposableTestDb() either returns an open connection to a database that
// has passed every check below, or prints why not and exits with code 2 BEFORE
// anything is modified. Nothing is truncated unless ALL of these hold:
//   1. NODE_ENV is not "production" and no VERCEL* variable is set.
//   2. DB_HOST, DB_USER and DB_NAME are set explicitly (no defaults), and
//      DB_NAME contains the word "test" as a delimited word
//      (blood_donor_test, test_db, ...).
//   3. CONFIRM_TRUNCATE_ALL_TABLES_IN is set to exactly "<DB_HOST>/<DB_NAME>".
//      Typing the target out is the explicit opt-in; "true"/"1" is not accepted.
//   4. The connected database really is DB_NAME.
//   5. Every existing user has an @test.dev email (data these tests leave
//      behind). A database containing any other user is treated as real data.
//
// DB_SSL=true enables TLS exactly as src/config/db.js does (required by
// TiDB Cloud). The session is pinned to UTC like the app's own pool.
import { createRequire } from 'node:module';

const refuse = (why) => {
  console.error(`\nREFUSING TO RUN (nothing was changed): ${why}\n`);
  process.exit(2);
};

// Tables the application writes to, children before parents.
const APPLICATION_TABLES = ['messages', 'conversations', 'request_responses', 'donations', 'requests', 'donor_profiles', 'users'];

export async function openDisposableTestDb() {
  const { DB_HOST, DB_PORT = '3306', DB_USER, DB_PASSWORD = '', DB_NAME, DB_SSL, CONFIRM_TRUNCATE_ALL_TABLES_IN } = process.env;

  // --- guards that need no database connection ------------------------------
  if (process.env.NODE_ENV === 'production') {
    refuse('NODE_ENV is "production". This test empties every table and must never run against production.');
  }
  const vercelVars = Object.keys(process.env).filter((k) => k === 'VERCEL' || k.startsWith('VERCEL_'));
  if (vercelVars.length > 0) {
    refuse(`running inside a Vercel environment (${vercelVars.join(', ')}). This test empties every table and must never run there.`);
  }
  if (!DB_HOST || !DB_USER || !DB_NAME) {
    refuse('set DB_HOST, DB_USER and DB_NAME explicitly (no defaults are assumed for a destructive test).');
  }
  if (!/(^|[^a-z0-9])test([^a-z0-9]|$)/i.test(DB_NAME)) {
    refuse(`DB_NAME "${DB_NAME}" does not contain "test" as a separate word (e.g. blood_donor_test). Use a dedicated test database.`);
  }
  const target = `${DB_HOST}/${DB_NAME}`;
  if (CONFIRM_TRUNCATE_ALL_TABLES_IN !== target) {
    refuse(
      `this test TRUNCATES ALL TABLES in ${target}.\n` +
      `To opt in, set CONFIRM_TRUNCATE_ALL_TABLES_IN=${target}\n` +
      `(it must match the target exactly; only do this for a disposable test database).`
    );
  }

  // --- guards that need the connection, still before anything is modified -----
  const useSsl = String(DB_SSL || '').toLowerCase() === 'true';
  const mysql = createRequire(process.cwd() + '/package.json')('mysql2/promise');
  let db;
  try {
    db = await mysql.createConnection({
      host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
      ...(useSsl ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
    });
  } catch (err) {
    refuse(`could not connect to ${target} (${err.code || err.message}). Check host/port/credentials${useSsl ? '' : ', and set DB_SSL=true for TiDB Cloud'}.`);
  }
  const [[{ db_name }]] = await db.query('SELECT DATABASE() AS db_name');
  if (db_name !== DB_NAME) {
    await db.end().catch(() => {});
    refuse(`connected to database "${db_name}" but DB_NAME is "${DB_NAME}".`);
  }
  let nonTestUsers;
  try {
    [[{ non_test_users: nonTestUsers }]] = await db.query("SELECT COUNT(*) AS non_test_users FROM users WHERE email NOT LIKE '%@test.dev'");
  } catch (err) {
    await db.end().catch(() => {});
    refuse(`could not read the users table in ${DB_NAME} (${err.code || err.message}). Apply schema.sql and the migrations first.`);
  }
  if (Number(nonTestUsers) > 0) {
    await db.end().catch(() => {});
    refuse(`${DB_NAME} contains ${nonTestUsers} user(s) that are not @test.dev test accounts. That looks like real data, so it will not be truncated.`);
  }

  // Everything passed: this really is a disposable test database.
  await db.query("SET time_zone = '+00:00'");
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of APPLICATION_TABLES) await db.query(`TRUNCATE ${t}`);
  await db.query('SET FOREIGN_KEY_CHECKS=1');

  const env = {
    ...process.env, JWT_SECRET: 'test-secret-not-real', ADMIN_BOOTSTRAP_SECRET: 'bootstrap-test',
    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME,
  };
  return { db, env };
}
