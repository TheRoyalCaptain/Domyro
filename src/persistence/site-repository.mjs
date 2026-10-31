// SPDX-License-Identifier: AGPL-3.0-only
// All site/area operations are scoped to the authenticated user ID passed by
// the future session-auth layer. No public unauthenticated HTTP endpoints.
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('invalid_id');
  return id;
}
function cleanName(value) {
  if (typeof value !== 'string') throw new TypeError('name_required');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new TypeError('invalid_name');
  return name;
}
function checkZone(zone) {
  if (typeof zone !== 'string' || zone.length > 100) throw new TypeError('invalid_time_zone');
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); }
  catch { throw new TypeError('invalid_time_zone'); }
  return zone;
}
function checkLocale(locale) {
  if (!['nl', 'en'].includes(locale)) throw new TypeError('invalid_locale');
  return locale;
}
export function validateSiteInput({ displayName, timeZone = 'Europe/Amsterdam', locale = 'nl' } = {}) {
  return Object.freeze({ displayName: cleanName(displayName), timeZone: checkZone(timeZone), locale: checkLocale(locale) });
}

export async function listSitesForUser(db, userId) {
  validateId(userId);
  const result = await db.query(`
    SELECT s.id, s.display_name, s.time_zone, s.locale, m.role
    FROM domyro_sites s
    JOIN domyro_site_memberships m ON m.site_id = s.id
    JOIN domyro_users u ON u.id = m.user_id
    WHERE m.user_id = $1 AND u.disabled_at IS NULL
    ORDER BY s.created_at, s.id
  `, [userId]);
  return result.rows;
}

/** Creates a site with a real owner in one DB transaction. */
export async function createSiteForUser(pool, userId, input) {
  validateId(userId);
  const { displayName, timeZone, locale } = validateSiteInput(input);
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query('BEGIN');
    transaction = true;
    const owner = await client.query('SELECT id FROM domyro_users WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [userId]);
    if (owner.rowCount !== 1) throw new Error('user_not_found');
    const installation = await client.query('SELECT id FROM domyro_installations WHERE singleton = TRUE FOR SHARE');
    if (installation.rowCount !== 1) throw new Error('installation_not_initialized');
    const siteId = randomUUID();
    await client.query(`
      INSERT INTO domyro_sites(id, installation_id, display_name, time_zone, locale)
      VALUES ($1, $2, $3, $4, $5)
    `, [siteId, installation.rows[0].id, displayName, timeZone, locale]);
    await client.query(`
      INSERT INTO domyro_site_memberships(site_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [siteId, userId]);
    await client.query('COMMIT');
    transaction = false;
    return Object.freeze({ id: siteId, displayName, timeZone, locale, role: 'owner' });
  } catch (error) {
    if (transaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listAreasForUser(db, userId, siteId) {
  validateId(userId);
  validateId(siteId);
  const result = await db.query(`
    SELECT a.id, a.display_name, a.sort_order
    FROM domyro_areas a
    JOIN domyro_site_memberships m ON m.site_id = a.site_id
    JOIN domyro_users u ON u.id = m.user_id
    WHERE a.site_id = $1 AND m.user_id = $2 AND u.disabled_at IS NULL
    ORDER BY a.sort_order, a.created_at, a.id
  `, [siteId, userId]);
  return result.rows;
}

export async function createAreaForUser(db, userId, siteId, displayName) {
  validateId(userId);
  validateId(siteId);
  const name = cleanName(displayName);
  const result = await db.query(`
    INSERT INTO domyro_areas(id, site_id, display_name)
    SELECT $1, $2, $3
    WHERE EXISTS (
      SELECT 1 FROM domyro_site_memberships m
      JOIN domyro_users u ON u.id = m.user_id
      WHERE m.site_id = $2 AND m.user_id = $4 AND u.disabled_at IS NULL
        AND m.role IN ('owner', 'admin', 'manager')
    )
    RETURNING id, display_name, sort_order
  `, [randomUUID(), siteId, name, userId]);
  if (!result.rowCount) throw new Error('site_permission_denied');
  return result.rows[0];
}
