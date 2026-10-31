// SPDX-License-Identifier: AGPL-3.0-only
// Internal authentication primitives. Intentionally NOT exposed over HTTP:
// rate limits, CSRF, owner bootstrap, TOTP/passkeys and secure cookies pending.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { hash, verify, Algorithm, Version } from '@node-rs/argon2';

const ARGON2_POLICY = Object.freeze({
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
});
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validatePassword(password) {
  if (typeof password !== 'string' || [...password].length < 12 || [...password].length > 256 || /[\u0000-\u001f\u007f]/.test(password)) throw new TypeError('password_policy_invalid');
  return password.normalize('NFC');
}
export async function hashPassword(password) {
  return hash(validatePassword(password), ARGON2_POLICY);
}
export async function verifyPassword(stored, attempt) {
  if (typeof stored !== 'string' || !stored.startsWith('$argon2id$')) return false;
  try { return await verify(stored, validatePassword(attempt)); }
  catch { return false; }
}
export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}
export function hashSessionToken(token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new TypeError('session_token_invalid');
  return createHash('sha256').update(token).digest();
}
export function sameSessionTokenHash(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== 32 || b.length !== 32) return false;
  return timingSafeEqual(a, b);
}

/** Explicit internal request only; neither cookie nor bearer token is stored plaintext. */
export async function createDbSession(db, userId, { durationSeconds = 3600 } = {}) {
  if (typeof userId !== 'string' || !UUID.test(userId)) throw new TypeError('invalid_user_id');
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 7 * 24 * 3600) throw new TypeError('session_duration_invalid');
  const token = generateSessionToken();
  const hashed = hashSessionToken(token);
  const result = await db.query(`
    INSERT INTO domyro_sessions(user_id, token_hash, expires_at)
    SELECT u.id, $2, now() + $3::integer * INTERVAL '1 second'
    FROM domyro_users u WHERE u.id = $1 AND u.disabled_at IS NULL
    RETURNING id, expires_at
  `, [userId, hashed, durationSeconds]);
  if (result.rowCount !== 1) throw new Error('session_user_not_available');
  return Object.freeze({ token, sessionId: result.rows[0].id, expiresAt: result.rows[0].expires_at });
}
export async function resolveDbSession(db, token) {
  let hashed;
  try { hashed = hashSessionToken(token); } catch { return null; }
  const result = await db.query(`
    SELECT s.id AS session_id, s.user_id AS user_id, s.expires_at
    FROM domyro_sessions s
    JOIN domyro_users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.revoked_at IS NULL AND s.expires_at > now()
      AND u.disabled_at IS NULL
  `, [hashed]);
  return result.rowCount === 1 ? Object.freeze(result.rows[0]) : null;
}
export async function revokeDbSession(db, sessionId, userId) {
  if (!UUID.test(sessionId ?? '') || !UUID.test(userId ?? '')) throw new TypeError('session_identity_invalid');
  const result = await db.query(`
    UPDATE domyro_sessions SET revoked_at = now()
    WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
    RETURNING id
  `, [sessionId, userId]);
  return result.rowCount === 1;
}
