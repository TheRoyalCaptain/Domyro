// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { loadMigrations, applyMigrations } from '../src/persistence/migrator.mjs';
import { createSiteForUser } from '../src/persistence/site-repository.mjs';
import {
  createZigbeeIntegrationForAdmin, reconcileZigbeeInventory,
  recordKnownZigbeeObservation, listZigbeeDevicesForUser, listZigbeeStateForUser,
} from '../src/persistence/zigbee-repository.mjs';

test('Zigbee inventory is durably site-scoped, preserves IEEE ID after rename and denies cross-site access', {
  skip: !process.env.DOMYRO_TEST_DATABASE_URL,
}, async () => {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString:process.env.DOMYRO_TEST_DATABASE_URL,max:4 });
  try {
    const client = await pool.connect();
    try { await applyMigrations(client, await loadMigrations()); } finally { client.release(); }
    const ownerA = randomUUID(), ownerB = randomUUID(), visitor = randomUUID();
    const marker = randomBytes(5).toString('hex');
    for (const [id,login] of [[ownerA,'za-'+marker],[ownerB,'zb-'+marker],[visitor,'zg-'+marker]]) {
      await pool.query('INSERT INTO domyro_users(id,login,password_hash) VALUES($1,$2,$3)',
        [id,login,'only-a-ci-fixture-password-hash-not-real']);
    }
    const siteA = await createSiteForUser(pool,ownerA,{displayName:'First Home'});
    const siteB = await createSiteForUser(pool,ownerB,{displayName:'Second Home'});
    await assert.rejects(() => createZigbeeIntegrationForAdmin(pool, {
      userId:ownerB,siteId:siteA.id,baseTopic:'z2m',
    }),/integration_permission_denied/);

    const integration = await createZigbeeIntegrationForAdmin(pool, {
      userId:ownerA, siteId:siteA.id,baseTopic:'z2m',displayName:'Read only Z2M',
    });
    const ieee = '0x00158d00018255df';
    const row = { id:ieee,friendlyName:'kitchen/plug',vendor:'CI',model:'PLUG1',supported:true };
    assert.deepEqual(await reconcileZigbeeInventory(pool, {
      integrationId:integration.id,siteId:siteA.id,devices:[row],
    }),{ imported:1,deleted:0 });
    const before = await listZigbeeDevicesForUser(pool,ownerA,siteA.id);
    assert.equal(before.length,1);
    assert.equal(before[0].external_id,ieee);
    assert.deepEqual(await listZigbeeDevicesForUser(pool,ownerB,siteA.id),[]);
    assert.deepEqual(await listZigbeeDevicesForUser(pool,visitor,siteA.id),[]);

    const observedAt = '2026-11-01T14:00:00.000Z';
    assert.equal(await recordKnownZigbeeObservation(pool,{
      integrationId:integration.id,siteId:siteA.id,externalId:ieee,field:'state',
      value:true,quality:'confirmed',observedAt,
    }),true);
    const ownerState = await listZigbeeStateForUser(pool,ownerA,siteA.id);
    assert.equal(ownerState.length,1);
    assert.equal(ownerState[0].value_json,true);
    assert.equal(ownerState[0].quality,'confirmed');
    assert.deepEqual(await listZigbeeStateForUser(pool,ownerB,siteA.id),[]);
    assert.deepEqual(await listZigbeeStateForUser(pool,visitor,siteA.id),[]);
    assert.equal(await recordKnownZigbeeObservation(pool,{
      integrationId:integration.id,siteId:siteA.id,externalId:ieee,field:'state',
      value:false,quality:'stale',observedAt:'2026-10-31T14:00:00.000Z',
    }),false); // Retained older data cannot overwrite newer confirmed observation.
    assert.equal((await listZigbeeStateForUser(pool,ownerA,siteA.id))[0].value_json,true);
    assert.equal(await recordKnownZigbeeObservation(pool,{
      integrationId:integration.id,siteId:siteA.id,externalId:ieee,field:'state',
      value:false,quality:'stale',observedAt:'2026-11-01T18:00:00.000Z',
    }),false); // Even a newer receive time cannot legitimize retained stale state.
    assert.equal((await listZigbeeStateForUser(pool,ownerA,siteA.id))[0].value_json,true);

    await reconcileZigbeeInventory(pool,{
      integrationId:integration.id,siteId:siteA.id,devices:[{...row,friendlyName:'kitchen/renamed'}],
    });
    const after = await listZigbeeDevicesForUser(pool,ownerA,siteA.id);
    assert.equal(after.length,1);
    assert.equal(after[0].id,before[0].id);
    assert.equal(after[0].friendly_name,'kitchen/renamed');
    assert.equal((await listZigbeeStateForUser(pool,ownerA,siteA.id))[0].value_json,true);

    // Persisted integration cannot be rebound to another site by an ingest event.
    await assert.rejects(() => reconcileZigbeeInventory(pool,{
      integrationId:integration.id,siteId:siteB.id,devices:[row],
    }), /integration_not_registered_for_site/);
    assert.equal(await recordKnownZigbeeObservation(pool,{
      integrationId:integration.id,siteId:siteB.id,externalId:ieee,field:'state',
      value:false,quality:'confirmed',observedAt:'2026-11-01T15:00:00.000Z',
    }),false);
    assert.deepEqual(await listZigbeeDevicesForUser(pool,ownerB,siteB.id),[]);
    assert.equal(await recordKnownZigbeeObservation(pool,{
      integrationId:integration.id,siteId:siteA.id,externalId:'0x00158d0001825500',field:'state',
      value:true,quality:'confirmed',observedAt,
    }),false); // No spontaneous device creation from MQTT state.
    await assert.rejects(() => reconcileZigbeeInventory(pool,{
      integrationId:integration.id,siteId:siteA.id,devices:[row,row],
    }),/duplicate_ieee_address/);
    assert.equal((await listZigbeeDevicesForUser(pool,ownerA,siteA.id)).length,1);
  } finally { await pool.end(); }
});
test('Zigbee observations are strictly typed and invalid input never accesses SQL', async () => {
  const fake = { async query() { throw new Error('should_never_query'); } };
  const a = randomUUID();
  const shared = { integrationId:a,siteId:randomUUID(),externalId:'0x00158d00018255df',
    field:'state',value:true,quality:'confirmed',observedAt:'2026-11-01T12:00:00Z' };
  await assert.rejects(() => recordKnownZigbeeObservation(fake,{...shared,field:'payload;DROP TABLE'}),/invalid_observation/);
  await assert.rejects(() => recordKnownZigbeeObservation(fake,{...shared,value:'ON'}),/invalid_observation/);
  await assert.rejects(() => recordKnownZigbeeObservation(fake,{...shared,quality:'physical_confirmation_unknown'}),/invalid_observation/);
  await assert.rejects(() => recordKnownZigbeeObservation(fake,{...shared,externalId:'bridge/state'}),/invalid_observation/);
});
