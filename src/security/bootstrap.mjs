// SPDX-License-Identifier: AGPL-3.0-only
// Console-only initial owner setup. Never expose this through HTTP.
// Requires an explicitly migrated, isolated PostgreSQL database.
import { randomUUID } from 'node:crypto';
import { hashPassword } from './credentials.mjs';
import { validateSiteInput } from '../persistence/site-repository.mjs';

export function validateOwnerLogin(login) {
  if (typeof login !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login)) throw new TypeError('owner_login_invalid');
  return login;
}

/**
 * One owner per uninitialized installation. Serializes concurrent bootstraps in
 * PostgreSQL and commits account, site and membership in the same transaction.
 * A database with any existing account is never implicitly taken over.
 */
export async function bootstrapOwner(pool, { login, password, site }) {
  validateOwnerLogin(login);
  const input = validateSiteInput(site);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', ['4182161402']);
    const installed = await client.query('SELECT id FROM domyro_installations WHERE singleton = true FOR UPDATE');
    if (installed.rowCount !== 1) throw new Error('installation_not_initialized');
    const count = await client.query('SELECT count(*)::integer AS n FROM domyro_users');
    if (count.rows[0].n !== 0) throw new Error('owner_already_initialized');
    const userId = randomUUID(), siteId = randomUUID();
    await client.query('INSERT INTO domyro_users(id, login, password_hash) VALUES($1,$2,$3)', [userId, login, passwordHash]);
    await client.query('INSERT INTO domyro_sites(id,installation_id,display_name,time_zone,locale) VALUES($1,$2,$3,$4,$5)',
      [siteId, installed.rows[0].id, input.displayName, input.timeZone, input.locale]);
    await client.query("INSERT INTO domyro_site_memberships(site_id,user_id,role) VALUES($1,$2,'owner')", [siteId, userId]);
    await client.query('COMMIT');
    transaction = false;
    return Object.freeze({ userId, siteId, login, siteName: input.displayName });
  } catch (error) {
    if (transaction) await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
