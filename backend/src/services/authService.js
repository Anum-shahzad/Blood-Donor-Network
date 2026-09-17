// Password hashing and JWT issuance/verification — the only place either
// should happen. Routes call these functions; they never touch bcrypt or
// jsonwebtoken directly.
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set — check your .env file');
  }
  return secret;
}

// payload should only ever contain non-sensitive identifiers: id, role, email.
// Never put password hashes or anything sensitive in a JWT payload — it is
// base64-encoded, not encrypted, and readable by anyone holding the token.
export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
