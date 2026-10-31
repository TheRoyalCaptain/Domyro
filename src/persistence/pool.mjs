// SPDX-License-Identifier: AGPL-3.0-only
// Optional local PostgreSQL support for the development preview.
// The server never runs migrations as a side effect of starting.
import { readDatabaseConfiguration } from './db-config.mjs';
import { loadMigrations, inspectMigrationState } from './migrator.mjs';

export async function createPersistence(env = process.env) {
  const options = readDatabaseConfiguration(env);
  if (!options) return null;
  const { Pool } = await import('pg');
  const pool = new Pool(options);
  const migrations = await loadMigrations();
  return Object.freeze({
    db: pool, // Internal server-only handle; never send to the browser.
    async inspect() {
      let client;
      try {
        client = await pool.connect();
        return await inspectMigrationState(client, migrations);
      } catch {
        return { ready: false, reason: 'database_unavailable' };
      } finally {
        if (client) client.release();
      }
    },
    async close() { await pool.end(); },
  });
}
