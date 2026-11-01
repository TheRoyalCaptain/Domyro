// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { connect } from 'mqtt';
import { readMqttPreviewConfig } from './mqtt-preview-config.mjs';
import { createZigbee2MqttObserver } from './zigbee2mqtt-observer.mjs';

/**
 * A *read-only* subscriber for an explicitly opted-in isolated localhost
 * broker. It will NEVER call mqttClient.publish(). The initial hardware
 * protocol proof uses an ephemeral test broker in CI, not the user's Zigbee mesh.
 */
export function createZigbee2MqttMqttPreview({ config, onUpdate = () => {}, connector = connect } = {}) {
  if (!config || config.readOnly !== true || typeof connector !== 'function') throw new TypeError('invalid_mqtt_preview_config');
  // Repeat validation at the transport boundary, not just the env parser.
  const validated = readMqttPreviewConfig({
    DOMYRO_MQTT_READONLY: '1', DOMYRO_MQTT_URL: config.url,
    DOMYRO_Z2M_BASE_TOPIC: config.baseTopic,
  });
  if (typeof onUpdate !== 'function') throw new TypeError('invalid_update_handler');
  const observer = createZigbee2MqttObserver({ baseTopic: validated.baseTopic });
  let client = null, stopped = false;
  function notify() {
    try { onUpdate(observer.snapshot()); }
    catch { /* Application observers must never crash the transport. */ }
  }
  return Object.freeze({
    snapshot: () => observer.snapshot(),
    async start({ timeoutMs = 5000 } = {}) {
      if (client) throw new Error('already_started');
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30000) throw new TypeError('invalid_timeout');
      stopped = false;
      const mqtt = connector(validated.url, {
        clientId: 'domyro-readonly-' + randomBytes(8).toString('hex'),
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 2000,
        queueQoSZero: false,
        resubscribe: false,
        keepalive: 20,
      });
      client = mqtt;
      let subscribed = false;
      mqtt.on('message', (topic, payload, packet) => {
        if (observer.accept(topic, payload, { retained: packet?.retain === true })) notify();
      });
      mqtt.on('offline', () => { observer.disconnected(); notify(); });
      mqtt.on('close', () => { observer.disconnected(); notify(); });
      mqtt.on('error', () => { /* Avoid surfacing broker credentials / internal URLs. */ });

      const subscribe = (resolve, reject) => {
        observer.brokerConnected();
        notify();
        mqtt.subscribe(validated.baseTopic + '/#', { qos: 0 }, (error, granted) => {
          if (error || !Array.isArray(granted) || granted[0]?.qos === 128) {
            if (reject) reject(new Error('mqtt_subscription_failed'));
            return;
          }
          subscribed = true;
          if (resolve) resolve();
        });
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
          reject(new Error('mqtt_connection_timeout'));
          await this.stop();
        }, timeoutMs);
        const ready = () => {
          clearTimeout(timer);
          resolve({ subscribed: true, readOnly: true });
        };
        const fail = error => {
          clearTimeout(timer);
          reject(error);
        };
        // On every reconnect, subscribe again. Subscription is read-only.
        mqtt.on('connect', () => {
          if (stopped) return;
          if (!subscribed) subscribe(ready, fail);
          else subscribe(null, null);
        });
      });
    },
    async stop() {
      stopped = true;
      if (!client) return;
      const current = client;
      client = null;
      await new Promise(resolve => current.end(true, {}, resolve));
      observer.disconnected();
      notify();
    },
  });
}
