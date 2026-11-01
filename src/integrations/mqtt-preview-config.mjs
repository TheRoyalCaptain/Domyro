// SPDX-License-Identifier: AGPL-3.0-only
/** Development only: opt-in read-only MQTT subscriber, strictly on loopback. */
export function readMqttPreviewConfig(env = process.env) {
  if (env.DOMYRO_MQTT_READONLY !== '1') return null;
  if (!env.DOMYRO_MQTT_URL) throw new Error('mqtt_preview_url_required');
  let url;
  try { url = new URL(env.DOMYRO_MQTT_URL); }
  catch { throw new Error('mqtt_preview_url_invalid'); }
  if (url.protocol !== 'mqtt:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('mqtt_preview_loopback_plaintext_only');
  }
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error('mqtt_preview_port_invalid');
  }
  const baseTopic = env.DOMYRO_Z2M_BASE_TOPIC ?? 'zigbee2mqtt';
  if (!/^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64}){0,3}$/.test(baseTopic) ||
      baseTopic.split('/').includes('bridge')) {
    throw new Error('zigbee2mqtt_base_topic_invalid');
  }
  return Object.freeze({ url: url.toString(), baseTopic, readOnly: true });
}
