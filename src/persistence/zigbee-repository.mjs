// SPDX-License-Identifier: AGPL-3.0-only
// Internal SQL repository. Never expose unscoped MQTT events over HTTP.
import { randomUUID } from 'node:crypto';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IEEE = /^0x[0-9a-f]{16}$/i;
const TOPIC = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64}){0,3}$/;
const FIELDS = new Set(['state','temperature','humidity','battery','occupancy','contact','water_leak','brightness','linkquality']);
const QUALITIES = new Set(['confirmed','stale','unavailable','unknown']);
const requireUuid = x => { if (typeof x !== 'string' || !UUID.test(x)) throw new TypeError('invalid_uuid'); return x; };
function cleanName(x, max = 100) {
  if (typeof x !== 'string' || !x.trim() || [...x].length > max || /[\u0000-\u001f\u007f]/.test(x)) throw new TypeError('invalid_display_name');
  return x.trim();
}

export async function createZigbeeIntegrationForAdmin(db, { userId, siteId, baseTopic = 'zigbee2mqtt', displayName = 'Zigbee2MQTT' }) {
  requireUuid(userId); requireUuid(siteId);
  if (!TOPIC.test(baseTopic)) throw new TypeError('invalid_base_topic');
  const result = await db.query([
    'INSERT INTO domyro_integrations(id,site_id,protocol,display_name,base_topic)',
    "SELECT $1,$2,'zigbee2mqtt',$3,$4",
    'WHERE EXISTS (SELECT 1 FROM domyro_site_memberships m',
    'JOIN domyro_users u ON u.id=m.user_id',
    "WHERE m.user_id=$5 AND m.site_id=$2 AND m.role IN ('owner','admin') AND u.disabled_at IS NULL)",
    'RETURNING id,site_id,protocol,display_name,base_topic',
  ].join(' '), [randomUUID(),siteId,cleanName(displayName),baseTopic,userId]);
  if (result.rowCount !== 1) throw new Error('integration_permission_denied');
  return result.rows[0];
}

/** An explicit known integration and site ID are required for all imports. */
export async function reconcileZigbeeInventory(pool, { integrationId, siteId, devices }) {
  requireUuid(integrationId);requireUuid(siteId);
  if (!Array.isArray(devices) || devices.length > 256) throw new TypeError('invalid_inventory');
  const seen = new Set();
  const rows = devices.map(item => {
    if (!item || typeof item !== 'object' || !IEEE.test(item.id ?? '') ||
      typeof item.supported !== 'boolean' ||
      typeof item.friendlyName !== 'string' || !item.friendlyName ||
      item.friendlyName.length > 128 || /[\u0000-\u001f\u007f]/.test(item.friendlyName) ||
      (item.model != null && (typeof item.model !== 'string' || item.model.length > 100)) ||
      (item.vendor != null && (typeof item.vendor !== 'string' || item.vendor.length > 100))) {
      throw new TypeError('invalid_inventory_device');
    }
    const id = item.id.toLowerCase();
    if (seen.has(id)) throw new TypeError('duplicate_ieee_address');
    seen.add(id);
    return { id, friendlyName:item.friendlyName, model:item.model ?? null, vendor:item.vendor ?? null, supported:item.supported };
  });
  const db = await pool.connect();
  let inTransaction = false;
  try {
    await db.query('BEGIN');
    inTransaction = true;
    const result = await db.query('SELECT id FROM domyro_integrations WHERE id=$1 AND site_id=$2 FOR SHARE', [integrationId,siteId]);
    if (result.rowCount !== 1) throw new Error('integration_not_registered_for_site');
    for (const item of rows) {
      await db.query([
        'INSERT INTO domyro_devices(id,site_id,integration_id,external_id,friendly_name,model,vendor,supported)',
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        'ON CONFLICT (integration_id,external_id) DO UPDATE',
        'SET friendly_name=EXCLUDED.friendly_name,model=EXCLUDED.model,vendor=EXCLUDED.vendor,',
        'supported=EXCLUDED.supported,updated_at=now()',
      ].join(' '), [randomUUID(),siteId,integrationId,item.id,item.friendlyName,item.model,item.vendor,item.supported]);
    }
    await db.query('COMMIT');
    inTransaction = false;
    // Removal from a bridge snapshot is NOT permission to delete history.
    return { imported: rows.length, deleted: 0 };
  } catch (error) {
    if (inTransaction) await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}
function valueAllowed(field, value) {
  if (['state','occupancy','contact','water_leak'].includes(field)) return typeof value === 'boolean';
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (['humidity','battery'].includes(field)) return value >= 0 && value <= 100;
  if (['brightness','linkquality'].includes(field)) return Number.isInteger(value) && value >= 0 && value <= 255;
  return field === 'temperature' && value > -100 && value < 200;
}
export async function recordKnownZigbeeObservation(db, { integrationId, siteId, externalId, field, value, quality, observedAt }) {
  requireUuid(integrationId); requireUuid(siteId);
  if (!IEEE.test(externalId ?? '') || !FIELDS.has(field) || !QUALITIES.has(quality) ||
    !valueAllowed(field,value) || typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError('invalid_observation');
  }
  const result = await db.query([
    'INSERT INTO domyro_observations(device_id,field,value_json,quality,observed_at)',
    'SELECT d.id,$4,$5::jsonb,$6,$7::timestamptz FROM domyro_devices d',
    'WHERE d.integration_id=$1 AND d.site_id=$2 AND d.external_id=$3 AND d.supported=TRUE',
    'ON CONFLICT (device_id,field) DO UPDATE',
    'SET value_json=EXCLUDED.value_json,quality=EXCLUDED.quality,',
    'observed_at=EXCLUDED.observed_at,recorded_at=now()',
    'WHERE domyro_observations.observed_at <= EXCLUDED.observed_at RETURNING device_id',
  ].join(' '), [integrationId,siteId,externalId.toLowerCase(),field,JSON.stringify(value),quality,observedAt]);
  return result.rowCount === 1;
}
export async function listZigbeeDevicesForUser(db, userId, siteId) {
  requireUuid(userId);requireUuid(siteId);
  const { rows } = await db.query([
    'SELECT d.id,d.integration_id,d.external_id,d.friendly_name,d.model,d.vendor,d.supported',
    'FROM domyro_devices d JOIN domyro_site_memberships m ON m.site_id=d.site_id',
    'JOIN domyro_users u ON u.id=m.user_id',
    'WHERE d.site_id=$1 AND m.user_id=$2 AND u.disabled_at IS NULL',
    'ORDER BY d.external_id LIMIT 256',
  ].join(' '), [siteId,userId]);
  return rows;
}
export async function listZigbeeStateForUser(db, userId, siteId) {
  requireUuid(userId);requireUuid(siteId);
  const { rows } = await db.query([
    'SELECT d.external_id,o.field,o.value_json,o.quality,o.observed_at',
    'FROM domyro_observations o JOIN domyro_devices d ON d.id=o.device_id',
    'JOIN domyro_site_memberships m ON m.site_id=d.site_id',
    'JOIN domyro_users u ON u.id=m.user_id',
    'WHERE d.site_id=$1 AND m.user_id=$2 AND u.disabled_at IS NULL',
    'ORDER BY d.external_id,o.field LIMIT 2304',
  ].join(' '), [siteId,userId]);
  return rows;
}
