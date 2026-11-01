// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { loadMigrations, applyMigrations } from '../src/persistence/migrator.mjs';
import { createSiteForUser } from '../src/persistence/site-repository.mjs';
import { createZigbeeIntegrationForAdmin, listZigbeeDevicesForUser, listZigbeeStateForUser } from '../src/persistence/zigbee-repository.mjs';
import { createZigbee2MqttObserver } from '../src/integrations/zigbee2mqtt-observer.mjs';
import { createSiteBoundZigbeeIngestor } from '../src/integrations/zigbee2mqtt-ingest.mjs';

test('read-only MQTT observations persist in one explicitly owner-approved home, retaining stable IEEE identity', {
  skip: !process.env.DOMYRO_TEST_DATABASE_URL,
}, async () => {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString:process.env.DOMYRO_TEST_DATABASE_URL,max:3 });
  try {
    const db = await pool.connect();
    try { await applyMigrations(db,await loadMigrations()); } finally { db.release(); }
    const owner = randomUUID(), stranger = randomUUID();
    const suffix = randomBytes(5).toString('hex');
    await pool.query('INSERT INTO domyro_users(id,login,password_hash) VALUES ($1,$2,$3),($4,$5,$6)',
      [owner,'io-'+suffix,'not-real-hash-only-for-disposable-ci',stranger,'ix-'+suffix,'not-real-hash-only-for-disposable-ci']);
    const home = await createSiteForUser(pool,owner,{displayName:'MQTT Test Home'});
    const other = await createSiteForUser(pool,stranger,{displayName:'Other Home'});
    const integration = await createZigbeeIntegrationForAdmin(pool,{userId:owner,siteId:home.id,baseTopic:'zigbee2mqtt'});
    const observer = createZigbee2MqttObserver();
    const ingestor = createSiteBoundZigbeeIngestor({ pool, integrationId:integration.id, siteId:home.id });
    const payload = x => Buffer.from(JSON.stringify(x));
    const ieee='0x00158d00018255df';
    const dev={ieee_address:ieee,friendly_name:'test/plug',type:'Router',supported:true,
      definition:{model:'TEST-PLUG',vendor:'Test manufacturer'}};
    observer.brokerConnected();
    observer.accept('zigbee2mqtt/bridge/state',payload({state:'online'}));
    observer.accept('zigbee2mqtt/bridge/devices',payload([dev]));
    observer.accept('zigbee2mqtt/test/plug',payload({state:'ON',linkquality:95}),{at:'2026-11-01T10:00:00Z'});
    const first=await ingestor.ingest(observer.snapshot());
    assert.equal(first.recorded,2);
    assert.equal((await listZigbeeDevicesForUser(pool,owner,home.id)).length,1);
    assert.equal((await listZigbeeStateForUser(pool,owner,home.id)).find(r=>r.field==='state').value_json,true);
    assert.deepEqual(await listZigbeeDevicesForUser(pool,stranger,home.id),[]);
    assert.deepEqual(await listZigbeeStateForUser(pool,stranger,home.id),[]);
    assert.deepEqual(await listZigbeeDevicesForUser(pool,stranger,other.id),[]);
    const original=(await listZigbeeDevicesForUser(pool,owner,home.id))[0].id;
    observer.accept('zigbee2mqtt/bridge/devices',payload([{...dev,friendly_name:'test/renamed'}]));
    observer.accept('zigbee2mqtt/test/renamed',payload({state:'OFF'}),{at:'2026-11-01T10:02:00Z',retained:true});
    const stale=await ingestor.ingest(observer.snapshot());
    assert.equal(stale.recorded,0); // Retained message cannot overwrite live confirmed state.
    assert.equal((await listZigbeeDevicesForUser(pool,owner,home.id))[0].id,original);
    assert.equal((await listZigbeeStateForUser(pool,owner,home.id)).find(r=>r.field==='state').value_json,true);
    observer.accept('zigbee2mqtt/test/renamed',payload({state:'OFF'}),{at:'2026-11-01T10:03:00Z'});
    const live=await ingestor.ingest(observer.snapshot());
    assert.ok(live.recorded>=1);
    assert.equal((await listZigbeeStateForUser(pool,owner,home.id)).find(r=>r.field==='state').value_json,false);
    observer.disconnected();
    const offline=await ingestor.ingest(observer.snapshot());
    assert.equal(offline.skipped,true);
    assert.equal((await listZigbeeStateForUser(pool,owner,home.id)).find(r=>r.field==='state').value_json,false);
    await ingestor.drain();
  } finally { await pool.end(); }
});
test('site ingest refuses unbound or non-read-only state before database calls', async () => {
  const fakePool={
    connect:async()=>{throw Error('must-not-use-db');},
    query:async()=>{throw Error('must-not-use-db');},
  };
  const x=createSiteBoundZigbeeIngestor({pool:fakePool,siteId:randomUUID(),integrationId:randomUUID()});
  await assert.rejects(()=>x.ingest({readOnly:false,transport:'connected',bridge:'online',devices:[]}),/untrusted_zigbee_snapshot/);
  assert.deepEqual(await x.ingest({readOnly:true,transport:'disconnected',bridge:'offline',devices:[]}),
    {skipped:true,reason:'offline',recorded:0});
});
