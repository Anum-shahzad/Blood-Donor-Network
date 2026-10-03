import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import donorsRouter from './routes/donors.js';
import requestsRouter from './routes/requests.js';
import adminRouter from './routes/admin.js';
import conversationsRouter from './routes/conversations.js';
import publicRouter from './routes/public.js';
import { errorHandler } from './middleware/errorHandler.js';
import { expireOverdueRequests } from './services/requestLifecycle.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  // Fail at boot, loudly, instead of 500-ing on the first login.
  console.error('JWT_SECRET is not set — refusing to start.');
  process.exit(1);
}

const app = express();

// CORS_ORIGIN is a comma-separated list of allowed frontend origins, e.g.
// "https://your-app.vercel.app". Unset = allow all (fine for local dev only).
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  console.warn('CORS_ORIGIN is not set — the API accepts requests from any origin.');
}
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/public', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/donors', donorsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/conversations', conversationsRouter);

// 404 for anything unmatched
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Must be registered last
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Mark overdue requests as expired once a minute. The statement is
// idempotent, so running it on several instances is harmless.
async function sweepExpiredRequests() {
  try {
    const n = await expireOverdueRequests();
    if (n > 0) console.log(`Expired ${n} overdue request(s)`);
  } catch (err) {
    console.error('Expiry sweep failed:', err.message);
  }
}
sweepExpiredRequests();
setInterval(sweepExpiredRequests, 60 * 1000).unref();

export default app;
