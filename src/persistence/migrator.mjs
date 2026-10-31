// SPDX-License-Identifier: AGPL-3.0-only
// Strict, checksum-verified, manually invoked PostgreSQL schema migrations.
// Never run automatically on HTTP process startup or from update polling.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./migrations/', import.meta.url));
const LOCK_ID = '4182161401';

export async function loadMigrations({ directory = root } = {}) {
  const entries = await readdir(directory);
  const files = entries.filter(name => name.endsWith('.sql')).sort();
  if (!files.length || files.length !== entries.filter(name => !name.startsWith('.')).length) {
    throw new Error('migration_directory_invalid');
  }
  const seen = new Set();
  const result = [];
  for (const file of files) {
    if (!/^\d{3}_[a-z0-9_-]+\.sql$/.test(file)) throw new Error('migration_filename_invalid');
    const version = Number(file.slice(0, 3));
    if (version < 1 || seen.has(version)) throw new Error('migration_version_invalid');
    seen.add(version);
    const sql = await readFile(join(directory, file), 'utf8');
    if (sql.trim().length < 20) throw new Error('migration_empty');
    result.push(Object.freeze({
      version,
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    }));
  }
  for (let i = 0; i < result.length; i++) {
    if (result[i].version !== i + 1) throw new Error('migration_sequence_invalid');
  }
  return Object.freeze(result);
}

/**
 * Caller supplies a connected database client from a dedicated migration role.
 * Entire migration set runs inside a single transaction and session advisory lock.
 * @param {{query: (sql:string,params?:unknown[])=>Promise<any>}} client
 */
export async function applyMigrations(client, migrations) {
  if (!client || typeof client.query !== 'function' || !Array.isArray(migrations) || migrations.length === 0) throw new TypeError('invalid_migration_inputs');
  await client.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_ID]);
  let transaction = false;
  try {
    await client.query('BEGIN');
    transaction = true;
    await client.query(`CREATE TABLE IF NOT EXISTS domyro_schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version, checksum FROM domyro_schema_migrations ORDER BY version');
    const expected = new Map(migrations.map(item => [item.version, item.checksum]));
    for (const row of rows) {
      if (!expected.has(row.version)) throw new Error('database_schema_newer_than_code');
      if (row.checksum.trim() !== expected.get(row.version)) throw new Error('migration_checksum_mismatch_v' + row.version);
    }
    const applied = new Set(rows.map(row => row.version));
    const newlyApplied = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO domyro_schema_migrations(version,checksum) VALUES($1,$2)', [migration.version, migration.checksum]);
      newlyApplied.push(migration.version);
    }
    await client.query('COMMIT');
    transaction = false;
    return Object.freeze({ currentVersion: migrations.at(-1).version, newlyApplied });
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); }
      catch { /* Preserve original migration failure, do not proceed. */ }
    }
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_ID]);
  }
}

export async function inspectMigrationState(client, migrations) {
  if (!client || typeof client.query !== 'function' || !Array.isArray(migrations)) throw new TypeError('invalid_migration_inputs');
  const relation = await client.query("SELECT to_regclass('public.domyro_schema_migrations') IS NOT NULL AS present");
  if (!relation.rows[0]?.present) return { ready: false, reason: 'database_not_initialized' };
  const { rows } = await client.query('SELECT version, checksum FROM domyro_schema_migrations ORDER BY version');
  if (rows.length !== migrations.length) return { ready: false, reason: 'migration_count_mismatch' };
  for (let i = 0; i < migrations.length; i++) {
    if (rows[i].version !== migrations[i].version || rows[i].checksum.trim() !== migrations[i].checksum) {
      return { ready: false, reason: 'schema_version_or_checksum_mismatch' };
    }
  }
  return { ready: true, schemaVersion: migrations.at(-1)?.version ?? null };
}
