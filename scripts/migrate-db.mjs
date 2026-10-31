#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// NEVER run automatically on HTTP start or software update.
import { loadMigrations, applyMigrations, inspectMigrationState } from '../src/persistence/migrator.mjs';
import { readDatabaseConfiguration } from '../src/persistence/db-config.mjs';

async function main() {
  const action = process.argv[2];
  if (!['--check', '--apply'].includes(action) || process.argv.length !== 3) {
    throw new Error('usage: node scripts/migrate-db.mjs --check|--apply');
  }
  const config = readDatabaseConfiguration();
  if (!config) throw new Error('database_not_configured');
  const { Pool } = await import('pg');
  const pool = new Pool(config);
  try {
    const migrations = await loadMigrations();
    const client = await pool.connect();
    try {
      const result = action === '--apply'
        ? await applyMigrations(client, migrations)
        : await inspectMigrationState(client, migrations);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (action === '--check' && !result.ready) process.exitCode = 2;
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch(error => {
  // Do not log raw pg connection errors, which can embed usernames/hostnames.
  const safeCodes = ['database_not_configured', 'database_url_invalid', 'database_url_protocol_invalid', 'preview_database_must_be_loopback_only',
    'database_credentials_required', 'database_url_options_not_supported',
    'migration_checksum_mismatch', 'database_schema_newer_than_code'];
  const safe = safeCodes.some(s => error.message?.startsWith(s));
  process.stderr.write('Migration operation stopped: ' + (safe ? error.message : 'connection_or_migration_failed') + '\n');
  process.exitCode = 1;
});
