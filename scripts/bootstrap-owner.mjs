#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Isolated, console-only development bootstrap. Never invoke automatically.
import { open, lstat } from 'node:fs/promises';
import { loadMigrations, inspectMigrationState } from '../src/persistence/migrator.mjs';
import { readDatabaseConfiguration } from '../src/persistence/db-config.mjs';
import { bootstrapOwner } from '../src/security/bootstrap.mjs';

async function readSecretFile(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('absolute_password_file_required');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 12 || stat.size > 2048 || (stat.mode & 0o077)) {
    throw new Error('password_file_must_be_private_regular_file');
  }
  const handle = await open(path, 'r');
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.ino !== stat.ino || actual.dev !== stat.dev || (actual.mode & 0o077)) {
      throw new Error('password_file_changed');
    }
    return (await handle.readFile('utf8')).replace(/\r?\n$/, '');
  } finally { await handle.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--login' || args[2] !== '--site' || args[4] !== '--password-file') {
    throw new Error('usage: node scripts/bootstrap-owner.mjs --login <lowercase-login> --site <site-name> --password-file <absolute-private-path>');
  }
  const options = readDatabaseConfiguration();
  if (!options) throw new Error('database_not_configured');
  const password = await readSecretFile(args[5]);
  const { Pool } = await import('pg');
  const pool = new Pool(options);
  try {
    const migrations = await loadMigrations();
    const client = await pool.connect();
    try {
      const inspected = await inspectMigrationState(client, migrations);
      if (!inspected.ready) throw new Error('database_not_migrated');
    } finally { client.release(); }
    const result = await bootstrapOwner(pool, { login: args[1], password, site: { displayName: args[3] } });
    console.log('Local development owner account created:', result.login, 'site:', result.siteName);
    console.log('Delete your temporary password file securely. No changes were made to other services.');
  } finally { await pool.end(); }
}
main().catch(e => {
  const safe = ['usage:', 'database_not_configured', 'database_not_migrated',
    'owner_already_initialized', 'absolute_password_file_required',
    'password_file_must_be_private_regular_file', 'password_file_changed',
    'owner_login_invalid', 'password_policy_invalid', 'invalid_name'];
  const message = safe.some(prefix => e.message?.startsWith(prefix)) ? e.message : 'bootstrap_failed';
  console.error(message);
  process.exitCode = 1;
});
