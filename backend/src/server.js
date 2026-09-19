import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import donorsRouter from './routes/donors.js';
import requestsRouter from './routes/requests.js';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/donors', donorsRouter);
app.use('/api/requests', requestsRouter);

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

export default app;
