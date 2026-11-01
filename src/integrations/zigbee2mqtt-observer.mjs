// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only, ephemeral Zigbee2MQTT observer.
 * No command, pairing, permit_join, /set or /request topics can be published.
 * Does not change coordinator ownership, HA, or existing Zigbee2MQTT settings.
 */
const IEEE = /^0x[0-9a-f]{16}$/i;
const FRIENDLY = /^[^\u0000-\u001f\u007f+#]{1,128}$/;
const MAX_DEVICES = 256, MAX_BYTES = 64 * 1024;

function safeFriendly(value) {
  if (typeof value !== 'string' || !FRIENDLY.test(value) || value.startsWith('/') ||
      value.endsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || part === 'bridge')) return null;
  return value;
}
function stateValue(raw, key) {
  const value = raw[key];
  switch (key) {
    case 'state': return value === 'ON' ? true : value === 'OFF' ? false : undefined;
    case 'occupancy': case 'contact': case 'water_leak': return typeof value === 'boolean' ? value : undefined;
    case 'battery': case 'humidity': return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
    case 'brightness': case 'linkquality': return Number.isInteger(value) && value >= 0 && value <= 255 ? value : undefined;
    case 'temperature': return typeof value === 'number' && Number.isFinite(value) && value > -100 && value < 200 ? value : undefined;
    default: return undefined;
  }
}
const VALUES = ['state', 'temperature', 'humidity', 'battery', 'occupancy', 'contact', 'water_leak', 'brightness', 'linkquality'];
function cleanState(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const output = Object.create(null);
  for (const field of VALUES) {
    const value = stateValue(message, field);
    if (value !== undefined) output[field] = value;
  }
  return Object.keys(output).length ? { ...output } : null;
}
function parsePayload(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) return null;
  try { return JSON.parse(buffer.toString('utf8')); }
  catch { return null; }
}
function cleanDevice(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.ieee_address !== 'string' || !IEEE.test(item.ieee_address)) return null;
  const name = safeFriendly(item.friendly_name);
  if (!name) return null;
  return {
    id: item.ieee_address.toLowerCase(), friendlyName: name,
    model: typeof item.definition?.model === 'string' ? item.definition.model.slice(0, 100) : null,
    vendor: typeof item.definition?.vendor === 'string' ? item.definition.vendor.slice(0, 100) : null,
    supported: item.supported === true && item.disabled !== true,
    kind: ['Router', 'EndDevice', 'Coordinator'].includes(item.type) ? item.type : 'unknown',
  };
}
function snapshotRow(device) {
  const observations = {};
  for (const [key, data] of Object.entries(device.observations)) {
    observations[key] = Object.freeze({ ...data });
  }
  return Object.freeze({
    ...device.info, available: device.available,
    observations: Object.freeze(observations),
  });
}
/**
 * Stable IEEE address is always the identity, not mutable friendly_name.
 * Drops out-of-order/unknown topics, ignores command topics and never executes.
 */
export function createZigbee2MqttObserver({ baseTopic = 'zigbee2mqtt' } = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64}){0,3}$/.test(baseTopic)) {
    throw new TypeError('invalid_base_topic');
  }
  let bridgeOnline = false;
  let brokerConnected = false;
  const devices = new Map();
  const byFriendly = new Map();

  function setDisconnected() {
    brokerConnected = false;
    bridgeOnline = false;
    for (const device of devices.values()) {
      device.available = false;
      for (const entry of Object.values(device.observations)) entry.quality = 'unavailable';
    }
  }
  return Object.freeze({
    brokerConnected() { brokerConnected = true; },
    disconnected: setDisconnected,
    accept(topic, payload, { retained = false, at = new Date().toISOString() } = {}) {
      if (typeof topic !== 'string' || !topic.startsWith(baseTopic + '/')) return false;
      if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return false;
      const message = parsePayload(payload);
      if (message === null) return false;
      const suffix = topic.slice(baseTopic.length + 1);
      if (suffix === 'bridge/state') {
        const state = typeof message === 'string' ? message : message?.state;
        if (state !== 'online' && state !== 'offline') return false;
        bridgeOnline = state === 'online' && brokerConnected;
        if (!bridgeOnline) {
          for (const dev of devices.values()) {
            dev.available = false;
            for (const item of Object.values(dev.observations)) item.quality = 'unavailable';
          }
        }
        return true;
      }
      if (suffix === 'bridge/devices') {
        if (!Array.isArray(message) || message.length > MAX_DEVICES) return false;
        const incoming = new Map(), names = new Set();
        for (const raw of message) {
          const info = cleanDevice(raw);
          if (!info || incoming.has(info.id) || names.has(info.friendlyName)) return false;
          incoming.set(info.id, info);
          names.add(info.friendlyName);
        }
        byFriendly.clear();
        for (const [id, info] of incoming) {
          const old = devices.get(id);
          const renamed = old && old.info.friendlyName !== info.friendlyName;
          devices.set(id, {
            info,
            // Do not falsely keep old-name live state after rename.
            observations: renamed ? Object.create(null) : old?.observations ?? Object.create(null),
            available: !renamed && old?.available === true && bridgeOnline,
          });
          byFriendly.set(info.friendlyName, id);
        }
        for (const id of [...devices.keys()]) if (!incoming.has(id)) devices.delete(id);
        return true;
      }
      if (!bridgeOnline || !brokerConnected || suffix.startsWith('bridge/') ||
          suffix.endsWith('/set') || suffix.includes('/set/') ||
          suffix.endsWith('/get') || suffix.includes('/get/') ||
          suffix.endsWith('/availability') || suffix.endsWith('/action')) return false;
      const id = byFriendly.get(suffix);
      if (!id) return false;
      const device = devices.get(id);
      if (!device || !device.info.supported) return false;
      const clean = cleanState(message);
      if (!clean) return false;
      for (const [key, value] of Object.entries(clean)) {
        device.observations[key] = { value, observedAt: at, quality: retained ? 'stale' : 'confirmed' };
      }
      device.available = true;
      return true;
    },
    snapshot() {
      return Object.freeze({
        transport: brokerConnected ? 'connected' : 'disconnected',
        bridge: bridgeOnline ? 'online' : 'offline',
        // Never return direct references to mutable internal rows.
        devices: Object.freeze([...devices.values()].map(snapshotRow).sort((a, b) => a.id.localeCompare(b.id))),
        readOnly: true,
      });
    },
  });
}
