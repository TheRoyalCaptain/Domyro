// SPDX-License-Identifier: AGPL-3.0-only
// Explicitly local Postgres transport for the M1 preview. Encrypted remote
// Postgres setup and credential storage are reserved for the real installer.
export function readDatabaseConfiguration(env = process.env) {
  const raw = env.DOMYRO_DATABASE_URL;
  if (!raw) return null;
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('database_url_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('database_url_protocol_invalid');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('preview_database_must_be_loopback_only');
  }
  if (!url.username || !url.password || !url.pathname || url.pathname === '/') throw new Error('database_credentials_required');
  if (url.search || url.hash) throw new Error('database_url_options_not_supported');
  return Object.freeze({
    connectionString: raw,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: 'domyro-development-preview',
    allowExitOnIdle: true,
  });
}
