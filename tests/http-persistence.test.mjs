// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDomyroServer } from '../src/server.mjs';

test('even with a healthy DB the dev preview refuses production readiness', async t => {
  const server = createDomyroServer({ persistence: { inspect: async () => ({ ready: true, schemaVersion: 2 }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const status = await (await fetch(base + '/api/v1/public/status')).json();
  assert.equal(status.persistence, 'ready');
  assert.equal(status.productionReady, false);
  const readiness = await fetch(base + '/api/v1/health/ready');
  assert.equal(readiness.status, 503);
  assert.equal((await readiness.json()).reason, 'authentication_not_configured');
  assert.equal((await fetch(base + '/api/v1/sites')).status, 404);
});

test('DB outage is visible without exposing database credentials or allowing control', async t => {
  const server = createDomyroServer({ persistence: { inspect: async () => ({ ready: false, reason: 'database_unavailable' }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const status = await (await fetch(base + '/api/v1/public/status')).json();
  assert.equal(status.persistence, 'unavailable');
  const readiness = await fetch(base + '/api/v1/health/ready');
  assert.equal(readiness.status, 503);
  assert.equal((await readiness.json()).reason, 'database_unavailable');
  const notAvailable = await fetch(base + '/api/v1/sites', { method: 'POST', body: '{}' });
  assert.equal(notAvailable.status, 405);
});
