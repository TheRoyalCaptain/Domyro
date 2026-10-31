// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDomyroServer } from '../src/server.mjs';
import { readListenOptions } from '../src/lib/http.mjs';

test('safe listening defaults and invalid port rejection', () => {
  assert.deepEqual(readListenOptions({}), { host: '127.0.0.1', port: 8844 });
  assert.throws(() => readListenOptions({ DOMYRO_PORT: '65536' }), /out of range/);
  assert.throws(() => readListenOptions({ DOMYRO_PORT: 'abc' }), /integer/);
  assert.throws(() => readListenOptions({ DOMYRO_HOST: 'example.com' }), /explicit local/);
});

test('live server reports honest status and does not invent control endpoints', async (t) => {
  const server = createDomyroServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const live = await fetch(`${base}/api/v1/health/live`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, 'alive');
  assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(live.headers.get('cache-control'), 'no-store');
  const ready = await fetch(`${base}/api/v1/health/ready`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).reason, 'persistence_not_configured');
  const status = await (await fetch(`${base}/api/v1/public/status`)).json();
  assert.equal(status.productionReady, false);
  assert.equal(status.devices, 'not_connected');
  assert.equal((await fetch(`${base}/api/v1/sites`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/health/live`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/assets/styles.css`)).status, 200);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Domyro/);
  assert.equal((await fetch(`${base}/no-such-file`)).status, 404);
});
