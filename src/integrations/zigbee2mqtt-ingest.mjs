// SPDX-License-Identifier: AGPL-3.0-only
// Explicitly configured, site-scoped bridge between a read-only Zigbee2MQTT
// snapshot and PostgreSQL. Nothing connects automatically or publishes to MQTT.
import { reconcileZigbeeInventory, recordKnownZigbeeObservation } from '../persistence/zigbee-repository.mjs';

const ALLOWED = new Set(['state','temperature','humidity','battery','occupancy','contact','water_leak','brightness','linkquality']);
const MAX_PENDING = 16;

export function createSiteBoundZigbeeIngestor({ pool, integrationId, siteId }) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function' ||
      typeof integrationId !== 'string' || typeof siteId !== 'string') throw new TypeError('invalid_ingestion_dependencies');
  let tail = Promise.resolve(), pending = 0;
  async function process(snapshot) {
    if (!snapshot || snapshot.readOnly !== true || !Array.isArray(snapshot.devices) || snapshot.devices.length > 256) {
      throw new Error('untrusted_zigbee_snapshot');
    }
    if (snapshot.transport !== 'connected' || snapshot.bridge !== 'online') {
      return { skipped: true, reason: 'offline', recorded: 0 };
    }
    const inventory = [];
    const states = [];
    for (const device of snapshot.devices) {
      if (!device || typeof device.id !== 'string' || typeof device.friendlyName !== 'string' ||
          typeof device.supported !== 'boolean' || !device.observations ||
          typeof device.observations !== 'object' || Array.isArray(device.observations)) {
        throw new Error('invalid_device_snapshot');
      }
      inventory.push({
        id: device.id, friendlyName: device.friendlyName, supported: device.supported,
        model: device.model ?? null, vendor: device.vendor ?? null,
      });
      if (!device.supported) continue;
      for (const [field, observation] of Object.entries(device.observations)) {
        if (!ALLOWED.has(field) || !observation || !['stale','confirmed'].includes(observation.quality)) continue;
        states.push({
          integrationId,siteId,externalId:device.id,field,
          value:observation.value,quality:observation.quality,observedAt:observation.observedAt,
        });
      }
    }
    // Fail early if inventory is not an explicitly registered site integration.
    const imported = await reconcileZigbeeInventory(pool, { integrationId, siteId, devices: inventory });
    let recorded = 0;
    for (const item of states) if (await recordKnownZigbeeObservation(pool, item)) recorded++;
    return { imported: imported.imported, recorded, skipped: false };
  }
  return Object.freeze({
    /** Serializes snapshots to prevent reordering during reconnects. */
    ingest(snapshot) {
      if (pending >= MAX_PENDING) return Promise.reject(new Error('zigbee_ingestion_backpressure'));
      pending++;
      const job = tail.catch(() => {}).then(() => process(snapshot));
      tail = job.finally(() => { pending--; });
      // Avoid unhandled rejections from the internal serial tail promise.
      tail.catch(() => {});
      return job;
    },
    async drain() { await tail.catch(() => {}); },
  });
}
