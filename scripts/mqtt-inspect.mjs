#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit localhost-only read-only Zigbee2MQTT inspection for disposable
 * development broker fixtures. Not a production integration manager.
 */
import { readMqttPreviewConfig } from '../src/integrations/mqtt-preview-config.mjs';
import { createZigbee2MqttMqttPreview } from '../src/integrations/zigbee2mqtt-mqtt.mjs';

async function run() {
  if (process.argv.length > 3 || (process.argv[2] && !/^--observe-seconds=(?:[1-9]|1[0-5])$/.test(process.argv[2]))) {
    throw new Error('usage: npm run mqtt:inspect -- --observe-seconds=3');
  }
  const config = readMqttPreviewConfig();
  if (!config) throw new Error('mqtt_preview_explicit_opt_in_required');
  const seconds = Number(process.argv[2]?.split('=')[1] ?? 3);
  const observer = createZigbee2MqttMqttPreview({ config });
  try {
    await observer.start({ timeoutMs: 5000 });
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    const snapshot = observer.snapshot();
    // No transport URL, usernames, passwords, raw JSON or unapproved commands.
    console.log(JSON.stringify({
      mode: 'read_only_development', broker: snapshot.transport, bridge: snapshot.bridge,
      devices: snapshot.devices.map(device => ({
        ieee: device.id, friendlyName: device.friendlyName, model: device.model,
        supported: device.supported, observationFields: Object.keys(device.observations),
      })),
      commandsPublished: 0,
    }, null, 2));
  } finally {
    await observer.stop();
  }
}
run().catch(error => {
  const known = ['mqtt_preview_explicit_opt_in_required', 'mqtt_preview_url_required',
    'mqtt_preview_loopback_plaintext_only', 'mqtt_connection_timeout', 'mqtt_subscription_failed'];
  console.error(known.includes(error.message) ? error.message : 'mqtt_readonly_preview_failed');
  process.exitCode = 1;
});
