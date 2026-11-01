// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readMqttPreviewConfig } from '../src/integrations/mqtt-preview-config.mjs';
import { createZigbee2MqttObserver } from '../src/integrations/zigbee2mqtt-observer.mjs';
const source = 'zigbee2mqtt';
const dev1 = { ieee_address: '0x00158d00018255df', friendly_name: 'kitchen/plug', type: 'Router', supported: true,
  definition: { model: 'TEST-PLUG', vendor: 'FixtureCo' } };
const dev2 = { ieee_address: '0x00158d0001825500', friendly_name: 'hall/sensor', type: 'EndDevice', supported: true,
  definition: { model: 'TEST-SENSOR', vendor: 'FixtureCo' } };
const json = data => Buffer.from(JSON.stringify(data));
test('preview configuration is explicitly opted in and rejects non-loopback, credentials, arbitrary bases', () => {
  assert.equal(readMqttPreviewConfig({}), null);
  assert.equal(readMqttPreviewConfig({ DOMYRO_MQTT_URL: 'mqtt://127.0.0.1:1883' }), null);
  const x = readMqttPreviewConfig({ DOMYRO_MQTT_READONLY: '1', DOMYRO_MQTT_URL: 'mqtt://127.0.0.1:1883' });
  assert.equal(x.readOnly, true);
  assert.equal(x.baseTopic, 'zigbee2mqtt');
  for (const bad of ['mqtt://192.0.2.1:1883','mqtt://example.com','mqtt://user:pass@127.0.0.1','mqtt://127.0.0.1/?anything=1','ws://127.0.0.1:9001']) {
    assert.throws(() => readMqttPreviewConfig({ DOMYRO_MQTT_READONLY: '1', DOMYRO_MQTT_URL: bad }), /loopback_plaintext_only/);
  }
  assert.throws(() => readMqttPreviewConfig({ DOMYRO_MQTT_READONLY: '1', DOMYRO_MQTT_URL: 'mqtt://localhost', DOMYRO_Z2M_BASE_TOPIC: 'zigbee2mqtt/#' }), /base_topic_invalid/);
});
test('stable IEEE identity survives a rename; old-name messages and unlisted devices are ignored', () => {
  const observer = createZigbee2MqttObserver({ baseTopic: source });
  observer.brokerConnected();
  assert.equal(observer.accept(source + '/bridge/state', json({ state: 'online' })), true);
  assert.equal(observer.accept(source + '/bridge/devices', json([dev1,dev2])), true);
  const time = '2026-11-01T12:00:00Z';
  assert.equal(observer.accept(source + '/kitchen/plug', json({ state: 'ON', brightness: 127, battery: -55, injected: 99 }), { at: time }), true);
  const initial = observer.snapshot();
  assert.equal(initial.devices.length, 2);
  assert.equal(initial.devices.find(d => d.id === dev1.ieee_address).observations.state.value, true);
  assert.equal(initial.devices.find(d => d.id === dev1.ieee_address).observations.state.quality, 'confirmed');
  assert.equal(initial.devices.find(d => d.id === dev1.ieee_address).observations.battery, undefined);
  assert.equal(observer.accept(source + '/kitchen/plug/set', json({ state: 'OFF' })), false);
  assert.equal(observer.accept(source + '/bridge/request/permit_join', json({ value: true })), false);
  assert.equal(observer.accept(source + '/unknown', json({ state: 'OFF' })), false);
  const renamed = { ...dev1, friendly_name: 'newkitchen/plug' };
  assert.equal(observer.accept(source + '/bridge/devices', json([renamed,dev2])), true);
  const afterRename = observer.snapshot().devices.find(d => d.id === dev1.ieee_address);
  assert.equal(afterRename.friendlyName, 'newkitchen/plug');
  assert.deepEqual(afterRename.observations, {});
  assert.equal(observer.accept(source + '/kitchen/plug', json({ state: 'OFF' })), false);
  assert.equal(observer.accept(source + '/newkitchen/plug', json({ state: 'OFF' }), { retained: true, at: time }), true);
  assert.equal(observer.snapshot().devices.find(d => d.id === dev1.ieee_address).observations.state.quality, 'stale');
  // No mutable alias is handed to callers.
  initial.devices[0].observations.state && assert.equal(initial.devices[0].observations.state.value, true);
});
test('broker disconnect marks observations unavailable and invalid catalog cannot wipe prior good inventory', () => {
  const observer = createZigbee2MqttObserver();
  observer.brokerConnected();
  observer.accept(source + '/bridge/state', json({state:'online'}));
  observer.accept(source + '/bridge/devices', json([dev1]));
  observer.accept(source + '/kitchen/plug', json({ state: 'ON' }));
  assert.equal(observer.accept(source + '/bridge/devices', json([dev1, { ...dev2, friendly_name: dev1.friendly_name }])), false);
  assert.equal(observer.snapshot().devices.length, 1);
  assert.equal(observer.accept(source + '/bridge/devices', Buffer.from('invalid-json')), false);
  assert.equal(observer.accept(source + '/bridge/devices', Buffer.alloc(70000, 42)), false);
  observer.disconnected();
  assert.equal(observer.snapshot().transport, 'disconnected');
  assert.equal(observer.snapshot().devices[0].observations.state.quality, 'unavailable');
  observer.brokerConnected();
  observer.accept(source + '/bridge/state', json({ state: 'online' }));
  assert.equal(observer.snapshot().devices[0].observations.state.quality, 'unavailable');
  assert.equal(observer.accept(source + '/kitchen/plug', json({ state: 'OFF' })), true);
  assert.equal(observer.snapshot().devices[0].observations.state.quality, 'confirmed');
});
