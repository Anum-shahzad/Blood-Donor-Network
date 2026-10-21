import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import donorsRouter from './routes/donors.js';
import requestsRouter from './routes/requests.js';
import adminRouter from './routes/admin.js';
import conversationsRouter from './routes/conversations.js';
import notificationsRouter from './routes/notifications.js';
import publicRouter from './routes/public.js';
import verificationRouter from './routes/verification.js';
import adminVerificationRouter from './routes/adminVerification.js';
import requestEvidenceRouter from './routes/requestEvidence.js';
import adminRequestEvidenceRouter from './routes/adminRequestEvidence.js';
import { errorHandler } from './middleware/errorHandler.js';
import { expireOverdueRequests } from './services/requestLifecycle.js';
import { releaseExpiredCooldowns } from './services/donorCommitment.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  // Fail at boot, loudly, instead of 500-ing on the first login.
  console.error('JWT_SECRET is not set, refusing to start.');
  process.exit(1);
}

// On Vercel the app runs as a serverless function: there is no long-lived
// process, so we must not call app.listen() or rely on setInterval().
const isServerless = Boolean(process.env.VERCEL);

const app = express();

// CORS_ORIGIN is a comma-separated list of allowed frontend origins, e.g.
// "https://your-app.vercel.app". Unset = allow all (fine for local dev only).
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  console.warn('CORS_ORIGIN is not set, the API accepts requests from any origin.');
}
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
app.use(express.json());

// Mark overdue requests as expired. The statement is idempotent, so running
// it on several instances is harmless.
async function sweepExpiredRequests() {
  try {
    const n = await expireOverdueRequests();
    if (n > 0) console.log(`Expired ${n} overdue request(s)`);
  } catch (err) {
    console.error('Expiry sweep failed:', err.message);
  }
}

// Return donors to AVAILABLE once their post-donation cooldown has elapsed
// (see releaseExpiredCooldowns). Same contract as the sweep above: idempotent,
// so running it on several instances is harmless.
async function sweepExpiredCooldowns() {
  try {
    const n = await releaseExpiredCooldowns();
    if (n > 0) console.log(`Released ${n} donor(s) from expired cooldown`);
  } catch (err) {
    console.error('Cooldown release sweep failed:', err.message);
  }
}

// Every periodic sweep. Each one handles its own errors, so one failing never
// blocks the other. They run in parallel so the extra work costs no more than
// one database round trip of added latency.
function runSweeps() {
  return Promise.all([sweepExpiredRequests(), sweepExpiredCooldowns()]);
}

if (isServerless) {
  // No background timer in serverless, so run the sweep on incoming traffic,
  // at most once a minute per function instance.
  let lastSweep = 0;
  app.use((req, res, next) => {
    const now = Date.now();
    if (now - lastSweep < 60 * 1000) return next();
    lastSweep = now;
    runSweeps().finally(next);
  });
}

app.use('/api/health', healthRouter);
app.use('/api/public', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/donors', donorsRouter);
app.use('/api/verification', verificationRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/request-evidence', requestEvidenceRouter);
// Mounted before /api/admin so the more specific path is matched first.
app.use('/api/admin/verification', adminVerificationRouter);
app.use('/api/admin/request-evidence', adminRequestEvidenceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/notifications', notificationsRouter);

// 404 for anything unmatched
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Must be registered last
app.use(errorHandler);

if (!isServerless) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  runSweeps();
  setInterval(runSweeps, 60 * 1000).unref();
}

export default app;
