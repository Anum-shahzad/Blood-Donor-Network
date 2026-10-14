import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// All timestamps are handled in UTC end to end: the driver converts JS Dates
// as UTC, and every pooled connection runs with a UTC session time zone, so
// NOW() / DATETIME comparisons agree no matter where the server is hosted.
// DATE columns (e.g. last_donation_date) come back as plain 'YYYY-MM-DD'
// strings instead of Dates that shift by a day across time zones.
//
// Free hosted MySQL services (TiDB Cloud, Aiven, etc.) require an encrypted
// connection. Set DB_SSL=true in the backend environment variables to enable
// it. Leave it unset for local development or Railway.
const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: ['DATE'],
  ...(useSsl ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {}),
});

pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});
