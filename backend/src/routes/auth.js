import { Router } from 'express';
import { pool } from '../config/db.js';
import { hashPassword, comparePassword, signToken } from '../services/authService.js';
import { validateSignupPayload, isValidEmail, isValidPassword } from '../utils/validation.js';

const router = Router();

// POST /api/auth/signup — donor or requester only (see validation.js for why
// admin is excluded here).
router.post('/signup', async (req, res, next) => {
  try {
    const errors = validateSignupPayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const { name, email, password, role, phone, city, blood_group, last_donation_date } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, phone, city) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), normalizedEmail, passwordHash, role, phone || null, city || null]
    );
    const userId = result.insertId;

    // Donors get their profile row created immediately if they gave a blood
    // group at signup, so PATCH /api/donors/me/availability works right away.
    if (role === 'donor' && blood_group) {
      await pool.query(
        'INSERT INTO donor_profiles (user_id, blood_group, last_donation_date) VALUES (?, ?, ?)',
        [userId, blood_group, last_donation_date || null]
      );
    }

    const token = signToken({ id: userId, role, email: normalizedEmail });
    res.status(201).json({
      token,
      user: { id: userId, name: name.trim(), email: normalizedEmail, role, phone: phone || null, city: city || null },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!isValidEmail(email) || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    const user = rows[0];

    // Deliberately identical error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate registered emails.
    if (!user || !(await comparePassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ id: user.id, role: user.role, email: user.email });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, city: user.city },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/bootstrap-admin — creates the one and only admin account.
// Secret-gated and self-limiting: it refuses once any admin already exists,
// so there is no ongoing attack surface once it's used the one time it's
// needed. Set ADMIN_BOOTSTRAP_SECRET on the server before calling this, and
// there is no reason to keep it around afterward.
router.post('/bootstrap-admin', async (req, res, next) => {
  try {
    const { name, email, password, secret } = req.body;
    const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return res.status(403).json({ error: 'Invalid bootstrap secret' });
    }
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'name is required (min 2 characters)' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'a valid email is required' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const [existingAdmins] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existingAdmins.length > 0) {
      return res.status(409).json({ error: 'An admin account already exists — this endpoint only works once' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const [existingEmail] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name.trim(), normalizedEmail, passwordHash, 'admin']
    );

    const token = signToken({ id: result.insertId, role: 'admin', email: normalizedEmail });
    res.status(201).json({
      token,
      user: { id: result.insertId, name: name.trim(), email: normalizedEmail, role: 'admin' },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
