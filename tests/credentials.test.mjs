// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken, sameSessionTokenHash, createDbSession, resolveDbSession, revokeDbSession } from '../src/security/credentials.mjs';

test('Argon2id password hashing uses distinct salts and rejects weak/malformed passwords', async () => {
  const pass = 'only-a-test-passphrase-secure-length';
  const h1 = await hashPassword(pass);
  const h2 = await hashPassword(pass);
  assert.ok(h1.startsWith('$argon2id$'));
  assert.notEqual(h1, h2);
  assert.equal(await verifyPassword(h1, pass), true);
  assert.equal(await verifyPassword(h1, 'not-the-same-long-password'), false);
  assert.equal(await verifyPassword('malformed', pass), false);
  assert.equal(await verifyPassword(h1, 'tiny'), false);
  await assert.rejects(() => hashPassword('tiny'), /password_policy_invalid/);
});

test('session tokens are random, stored only hashed and compared safely', () => {
  const a = generateSessionToken(), b = generateSessionToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 43);
  const x = hashSessionToken(a), y = hashSessionToken(b);
  assert.equal(x.length, 32);
  assert.equal(sameSessionTokenHash(x, x), true);
  assert.equal(sameSessionTokenHash(x, y), false);
  assert.equal(sameSessionTokenHash(x, Buffer.alloc(1)), false);
  assert.throws(() => hashSessionToken('guessable'), /invalid/);
});

test('DB session creation is not exposed without valid ID or duration', async () => {
  const fake = { async query() { throw new Error('should_not_reach_database'); } };
  await assert.rejects(() => createDbSession(fake, 'not-a-uuid'), /invalid_user_id/);
  await assert.rejects(() => createDbSession(fake, randomUUID(), { durationSeconds: 0 }), /session_duration_invalid/);
  assert.equal(await resolveDbSession(fake, 'bad-token'), null);
  await assert.rejects(() => revokeDbSession(fake, 'not-a-uuid', randomUUID()), /session_identity_invalid/);
});

test('hashed session persists, expires/revokes and cannot be used with a forged token', { skip: !process.env.DOMYRO_TEST_DATABASE_URL }, async () => {
  const { Pool } = await import('pg');
  const { loadMigrations, applyMigrations } = await import('../src/persistence/migrator.mjs');
  const pool = new Pool({ connectionString: process.env.DOMYRO_TEST_DATABASE_URL, max: 2 });
  try {
    const client = await pool.connect();
    try { await applyMigrations(client, await loadMigrations()); } finally { client.release(); }
    const userId = randomUUID();
    await pool.query('INSERT INTO domyro_users(id,login,password_hash) VALUES($1,$2,$3)', [userId, 'security-test', await hashPassword('security-test-only-password')]);
    const session = await createDbSession(pool, userId, { durationSeconds: 1800 });
    const actor = await resolveDbSession(pool, session.token);
    assert.equal(actor.user_id, userId);
    assert.equal(await resolveDbSession(pool, generateSessionToken()), null);
    assert.equal(await revokeDbSession(pool, session.sessionId, userId), true);
    assert.equal(await resolveDbSession(pool, session.token), null);
    assert.equal(await revokeDbSession(pool, session.sessionId, userId), false);
    const { rows } = await pool.query('SELECT token_hash FROM domyro_sessions WHERE id=$1', [session.sessionId]);
    assert.equal(rows[0].token_hash.equals(Buffer.from(session.token)), false);
    assert.equal(rows[0].token_hash.length, 32);
  } finally { await pool.end(); }
});
