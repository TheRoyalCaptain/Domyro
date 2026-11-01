// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bounded development proof of actual PostgreSQL custom-format backup/restore.
 *
 * This is NOT the production backup service: it does not cover configuration,
 * Matter fabrics, external broker keys, disk streaming, large databases or
 * user-friendly disaster recovery. Restore is restricted to a named, EMPTY,
 * isolated test database, never an existing Domyro installation.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { encryptBackupBytes, decryptBackupBytes } from './encrypted-backup.mjs';
import { loadMigrations, inspectMigrationState } from '../persistence/migrator.mjs';

const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
const RESTORE_PREFIX = /^domyro_restore_test_[a-z0-9_]{6,40}$/;
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_TOOLS = Object.freeze({
  dump: Object.freeze({ executable: 'pg_dump', prefix: [] }),
  restore: Object.freeze({ executable: 'pg_restore', prefix: [] }),
});

function localDatabase(connectionString) {
  if (typeof connectionString !== 'string') throw new TypeError('database_connection_required');
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error('invalid_database_url'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !SAFE_IDENTIFIER.test(decodeURIComponent(url.pathname.slice(1))) ||
    !url.username || !url.password || url.search || url.hash) {
    throw new Error('isolated_local_database_required');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  const port = url.port || '5432';
  if (!/^[0-9]{2,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('invalid_database_port');
  return Object.freeze({
    database, host: url.hostname === '[::1]' ? '::1' : url.hostname,
    port, username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    connectionString,
  });
}
function selectedTool(spec, fallback) {
  const selected = spec ?? fallback;
  if (!selected || typeof selected.executable !== 'string' || !selected.executable ||
      !Array.isArray(selected.prefix) || selected.prefix.some(x => typeof x !== 'string')) {
    throw new TypeError('invalid_postgresql_tool');
  }
  // Internal developer-supplied tool specification only, never HTTP input.
  return selected;
}
async function runPostgresTool(tool, args, password, stdin = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.executable, [...tool.prefix, ...args], {
      shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: password },
    });
    let output = [], size = 0, stderrSize = 0, finished = false, failure = null;
    const timer = setTimeout(() => { failure = 'postgres_tool_timeout'; child.kill('SIGKILL'); }, TIMEOUT_MS);
    const settle = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve(value);
    };
    child.on('error', () => settle('postgres_tool_not_available'));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) {
        failure = 'database_archive_too_large_for_preview';
        child.kill('SIGKILL');
      } else output.push(chunk);
    });
    // Deliberately do not display database credentials or raw pg tool errors.
    child.stderr.on('data', chunk => {
      stderrSize += chunk.length;
      if (stderrSize > 64 * 1024) { failure = 'postgres_tool_error_output_excessive'; child.kill('SIGKILL'); }
    });
    child.on('close', code => {
      if (failure) settle(failure);
      else if (code !== 0) settle('postgres_tool_failed');
      else settle(null, Buffer.concat(output));
    });
    child.stdin.on('error', () => { /* A failed child is reported on close. */ });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}
function cliDatabaseArgs(db) {
  return ['--host', db.host, '--port', db.port, '--username', db.username, '--dbname', db.database];
}
function isCustomArchive(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.subarray(0, 5).toString('ascii') === 'PGDMP';
}

/** Read-only source DB operation. The signed/encrypted snapshot contains PG data only. */
export async function createEncryptedPostgresSnapshot({
  sourceUrl, password, tools = DEFAULT_TOOLS,
}) {
  const source = localDatabase(sourceUrl);
  const pgDump = selectedTool(tools.dump, DEFAULT_TOOLS.dump);
  const raw = await runPostgresTool(pgDump, [
    '--format=custom', '--no-owner', '--no-privileges', '--schema=public',
    ...cliDatabaseArgs(source),
  ], source.password);
  if (!isCustomArchive(raw)) throw new Error('not_a_postgresql_custom_archive');
  const record = Object.freeze({
    schemaVersion: 1,
    format: 'postgresql-custom',
    archiveSha256: createHash('sha256').update(raw).digest('hex'),
    archiveBytes: raw.length,
    databaseSchemaScope: 'public',
    createdAt: new Date().toISOString(),
  });
  const recordBytes = Buffer.from(JSON.stringify({
    metadata: record, archiveBase64: raw.toString('base64'),
  }));
  const encrypted = await encryptBackupBytes(recordBytes, password);
  // Developer-only payload, no file-system writes, no secrets in output.
  return Object.freeze({
    encrypted, metadata: record, restorable: false,
    explanation: 'Encrypted archive created; restore must still be verified on a clean test database.',
  });
}

/** Detect tampering before any process with write access is invoked. */
export async function verifyEncryptedPostgresSnapshot(encrypted, password) {
  const payload = await decryptBackupBytes(encrypted, password);
  let doc;
  try { doc = JSON.parse(payload.toString('utf8')); }
  catch { throw new Error('postgres_snapshot_metadata_invalid'); }
  const meta = doc?.metadata;
  if (meta?.schemaVersion !== 1 || meta?.format !== 'postgresql-custom' ||
      meta?.databaseSchemaScope !== 'public' ||
      !/^[a-f0-9]{64}$/.test(meta.archiveSha256 ?? '') ||
      !Number.isSafeInteger(meta.archiveBytes) || meta.archiveBytes < 8 || meta.archiveBytes > MAX_ARCHIVE_BYTES ||
      typeof doc.archiveBase64 !== 'string') throw new Error('postgres_snapshot_metadata_invalid');
  const raw = Buffer.from(doc.archiveBase64, 'base64');
  if (!isCustomArchive(raw) || raw.length !== meta.archiveBytes ||
      createHash('sha256').update(raw).digest('hex') !== meta.archiveSha256 ||
      raw.toString('base64') !== doc.archiveBase64) throw new Error('postgres_archive_integrity_failed');
  return { archive: raw, metadata: meta };
}

/**
 * Restoration may ONLY target a brand-new empty disposable test database.
 * No '--clean', '--create', database DROP or implicit migrations.
 */
export async function restoreEncryptedPostgresSnapshotToTestDatabase({
  encrypted, password, targetUrl, tools = DEFAULT_TOOLS,
}) {
  const target = localDatabase(targetUrl);
  if (!RESTORE_PREFIX.test(target.database)) throw new Error('restore_target_must_be_disposable_test_database');
  const verified = await verifyEncryptedPostgresSnapshot(encrypted, password);
  const pool = new Pool({
    connectionString: target.connectionString,
    max: 1, connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  try {
    const checked = await pool.query([
      "SELECT count(*)::int AS n FROM pg_catalog.pg_class c",
      "JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace",
      "WHERE ns.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')",
    ].join(' '));
    if (checked.rows[0]?.n !== 0) throw new Error('restore_target_not_empty');
    const restoreTool = selectedTool(tools.restore, DEFAULT_TOOLS.restore);
    await runPostgresTool(restoreTool, [
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges',
      '--schema=public', ...cliDatabaseArgs(target),
    ], target.password, verified.archive);
    const migrations = await loadMigrations();
    const client = await pool.connect();
    try {
      const state = await inspectMigrationState(client, migrations);
      if (!state.ready) throw new Error('restored_schema_verification_failed');
    } finally { client.release(); }
    return Object.freeze({
      verifiedRestore: true,
      database: target.database,
      archiveSha256: verified.metadata.archiveSha256,
      schemaVersion: migrations.at(-1).version,
    });
  } finally { await pool.end(); }
}
