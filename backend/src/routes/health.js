import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

// GET /api/health — used by the deploy pipeline and by the frontend
// to confirm both the API and the database are reachable.
router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'degraded', db: 'disconnected', message: err.message });
  }
});

export default router;
