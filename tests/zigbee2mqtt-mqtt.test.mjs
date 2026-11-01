// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Aedes } from 'aedes';
import { connect } from 'mqtt';
import { createZigbee2MqttMqttPreview } from '../src/integrations/zigbee2mqtt-mqtt.mjs';

const waitUntil = async (condition, label, ms = 6000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, 30));
  }
  assert.fail('timed out waiting for ' + label);
};
const devices = [{
  ieee_address: '0x00158d00018255df', friendly_name: 'office/plug', type: 'Router',
  supported: true, definition: { model: 'CI-PLUG', vendor: 'Simulated' },
}];

test('real MQTT client observes Zigbee2MQTT topics from disposable Aedes broker without publishing anything', async t => {
  const broker = await Aedes.createBroker();
  let outgoingFromObserver = 0;
  broker.on('publish', (packet, client) => {
    if (client?.id?.startsWith('domyro-readonly-')) outgoingFromObserver++;
  });
  const listener = createServer(broker.handle);
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = 'mqtt://127.0.0.1:' + listener.address().port;
  const observations = [];
  const preview = createZigbee2MqttMqttPreview({
    config: { url, baseTopic: 'zigbee2mqtt', readOnly: true },
    onUpdate: snapshot => observations.push(snapshot),
  });
  const sender = connect(url, { clientId: 'isolated-z2m-fixture-' + Date.now(), reconnectPeriod: 0 });
  t.after(async () => {
    await preview.stop();
    await new Promise(resolve => sender.end(true, {}, resolve));
    await new Promise(resolve => listener.close(resolve));
    await new Promise(resolve => broker.close(resolve));
  });
  await once(sender, 'connect');
  await preview.start();
  assert.equal(preview.snapshot().transport, 'connected');

  const publish = (topic, data, retain = false) => new Promise((resolve, reject) => {
    sender.publish('zigbee2mqtt/' + topic, JSON.stringify(data), { qos: 1, retain }, e => e ? reject(e) : resolve());
  });
  await publish('bridge/state', { state: 'online' }, true);
  await publish('bridge/devices', devices, true);
  await waitUntil(() => preview.snapshot().devices.length === 1 && preview.snapshot().bridge === 'online', 'device discovery');
  await publish('office/plug', { state: 'ON', linkquality: 77 });
  await waitUntil(() => preview.snapshot().devices[0]?.observations.state?.value === true, 'observed ON state');
  assert.equal(preview.snapshot().devices[0].observations.state.quality, 'confirmed');
  assert.equal(preview.snapshot().devices[0].observations.linkquality.value, 77);
  await publish('office/plug/set', { state: 'OFF' });
  assert.equal(preview.snapshot().devices[0].observations.state.value, true);
  assert.equal(outgoingFromObserver, 0);
  assert.ok(observations.length > 0);

  // New catalog with a renamed friendly name retains the IEEE identity.
  await publish('bridge/devices', [{ ...devices[0], friendly_name: 'office/renamed' }]);
  await waitUntil(() => preview.snapshot().devices[0]?.friendlyName === 'office/renamed', 'rename');
  assert.equal(preview.snapshot().devices[0].id, devices[0].ieee_address);
  assert.deepEqual(preview.snapshot().devices[0].observations, {});
  await publish('office/renamed', { state: 'OFF' });
  await waitUntil(() => preview.snapshot().devices[0]?.observations.state?.value === false, 'observed OFF state');
  await preview.stop();
  assert.equal(preview.snapshot().transport, 'disconnected');
  assert.equal(preview.snapshot().devices[0].observations.state.quality, 'unavailable');
  assert.equal(outgoingFromObserver, 0);
});
