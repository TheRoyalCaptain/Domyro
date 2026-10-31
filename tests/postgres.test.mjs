// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMigrations, applyMigrations, inspectMigrationState } from '../src/persistence/migrator.mjs';
import { readDatabaseConfiguration } from '../src/persistence/db-config.mjs';
import { validateSiteInput } from '../src/persistence/site-repository.mjs';

test('migration files are consecutive, nonempty and checksummed', async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map(m => m.version), [1, 2]);
  assert.equal(migrations[0].checksum.length, 64);
  assert.match(migrations[0].sql, /CREATE TABLE domyro_site_memberships/);
  assert.match(migrations[1].sql, /ON CONFLICT/);
});

test('migrator is explicit, atomic and refuses old migration rewrites', async () => {
  const migrations = await loadMigrations();
  let state = [], inTransaction = false, commits = 0, rollbacks = 0, locks = 0;
  const client = { async query(sql, params = []) {
    if (sql.includes('pg_advisory_lock(')) { locks++; return { rows: [] }; }
    if (sql.includes('pg_advisory_unlock(')) { locks--; return { rows: [] }; }
    if (sql === 'BEGIN') { inTransaction = true; return { rows: [] }; }
    if (sql === 'COMMIT') { inTransaction = false; commits++; return { rows: [] }; }
    if (sql === 'ROLLBACK') { inTransaction = false; rollbacks++; return { rows: [] }; }
    if (sql.includes('SELECT version, checksum FROM domyro_schema_migrations')) return { rows: state };
    if (sql.includes('INSERT INTO domyro_schema_migrations')) { state.push({ version: params[0], checksum: params[1] }); return { rows: [] }; }
    return { rows: [] };
  }};
  const first = await applyMigrations(client, migrations);
  assert.deepEqual(first.newlyApplied, [1, 2]);
  assert.equal(first.currentVersion, 2);
  const second = await applyMigrations(client, migrations);
  assert.deepEqual(second.newlyApplied, []);
  assert.equal(commits, 2);
  assert.equal(locks, 0);
  await assert.rejects(() => applyMigrations(client, [{ ...migrations[0], checksum: 'a'.repeat(64) }, migrations[1]]), /migration_checksum_mismatch_v1/);
  assert.equal(rollbacks, 1);
  assert.equal(inTransaction, false);
  assert.equal(locks, 0);
  assert.equal(state.length, 2);
});

test('unsafe database settings fail before any network connection', () => {
  assert.equal(readDatabaseConfiguration({}), null);
  const good = readDatabaseConfiguration({ DOMYRO_DATABASE_URL: 'postgresql://dbuser:test-secret@127.0.0.1:5432/domyro' });
  assert.equal(good.max, 5);
  assert.equal(good.connectionTimeoutMillis, 3000);
  assert.throws(() => readDatabaseConfiguration({ DOMYRO_DATABASE_URL: 'postgresql://u:p@192.0.2.10:5432/domyro' }), /loopback_only/);
  assert.throws(() => readDatabaseConfiguration({ DOMYRO_DATABASE_URL: 'file:///tmp/db' }), /protocol_invalid/);
  assert.throws(() => readDatabaseConfiguration({ DOMYRO_DATABASE_URL: 'postgresql://127.0.0.1/domyro' }), /credentials_required/);
});

test('site input validates names, supported locales and actual time zones', () => {
  const valid = validateSiteInput({ displayName: '  Woonkamer  ', timeZone: 'Europe/Amsterdam', locale: 'nl' });
  assert.equal(valid.displayName, 'Woonkamer');
  assert.throws(() => validateSiteInput({ displayName: '' }), /invalid_name/);
  assert.throws(() => validateSiteInput({ displayName: 'hi', timeZone: 'Not/AZone' }), /invalid_time_zone/);
  assert.throws(() => validateSiteInput({ displayName: 'hi', locale: 'de' }), /invalid_locale/);
});

test('postgres integration requires isolated explicit test database', { skip: !process.env.DOMYRO_TEST_DATABASE_URL }, async () => {
  const { Pool } = await import('pg');
  const { randomUUID } = await import('node:crypto');
  const pool = new Pool({ connectionString: process.env.DOMYRO_TEST_DATABASE_URL, max: 3, connectionTimeoutMillis: 3000 });
  const { createSiteForUser, listSitesForUser, listAreasForUser, createAreaForUser } = await import('../src/persistence/site-repository.mjs');
  try {
    const migrations = await loadMigrations();
    const client = await pool.connect();
    try {
      const applied = await applyMigrations(client, migrations);
      assert.equal(applied.currentVersion, 2);
      // Another test file may apply the same migrations first, in parallel.
      // The advisory-locked migrator is idempotent; both outcomes are valid.
      assert.ok(applied.newlyApplied.every(version => [1, 2].includes(version)));
      assert.ok(applied.newlyApplied.length === 0 || applied.newlyApplied.length === 2);
      assert.deepEqual((await applyMigrations(client, migrations)).newlyApplied, []);
      assert.equal((await inspectMigrationState(client, migrations)).ready, true);
    } finally { client.release(); }
    const owner = randomUUID(), visitor = randomUUID();
    await pool.query(`INSERT INTO domyro_users(id,login,password_hash)
      VALUES ($1,'test-owner','not-a-real-password-hash-test-only-placeholder'),
             ($2,'test-visitor','not-a-real-password-hash-test-only-placeholder')`, [owner, visitor]);
    const a = await createSiteForUser(pool, owner, { displayName: 'Home', timeZone: 'Europe/Amsterdam', locale: 'nl' });
    assert.equal(a.role, 'owner');
    assert.equal((await listSitesForUser(pool, owner)).length, 1);
    assert.equal((await listSitesForUser(pool, visitor)).length, 0);
    assert.deepEqual(await listAreasForUser(pool, visitor, a.id), []);
    const room = await createAreaForUser(pool, owner, a.id, 'Living room');
    assert.equal(room.display_name, 'Living room');
    assert.equal((await listAreasForUser(pool, owner, a.id)).length, 1);
    await assert.rejects(() => createAreaForUser(pool, visitor, a.id, 'Intrusion'), /site_permission_denied/);
    assert.deepEqual(await listAreasForUser(pool, visitor, a.id), []);
    // A second connection can still see persisted data and the applied migrations.
    const different = await pool.connect();
    try {
      assert.equal((await different.query('SELECT count(*)::int AS n FROM domyro_sites')).rows[0].n, 1);
      assert.equal((await inspectMigrationState(different, migrations)).ready, true);
    } finally { different.release(); }
    // Explicitly modified historical migrations MUST block later attempts.
    await assert.rejects(async () => {
      const c = await pool.connect();
      try { await applyMigrations(c, [{ ...migrations[0], checksum: '0'.repeat(64) }, migrations[1]]); }
      finally { c.release(); }
    }, /migration_checksum_mismatch_v1/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM domyro_sites')).rows[0].n, 1);
  } finally { await pool.end(); }
});
