// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createDomyroServer } from '../src/server.mjs';
import { createLocalAuthService } from '../src/security/http-auth.mjs';
import { createDbSession, hashPassword } from '../src/security/credentials.mjs';
import { sendJson } from '../src/lib/http.mjs';
import { bootstrapOwner } from '../src/security/bootstrap.mjs';
import { loadMigrations,applyMigrations } from '../src/persistence/migrator.mjs';
import {
  createZigbeeIntegrationForAdmin,reconcileZigbeeInventory,
  recordKnownZigbeeObservation,
} from '../src/persistence/zigbee-repository.mjs';

test('GET device inventory is site-scoped, logged-in, read-only and never authorizes device actions', {
  skip:!process.env.DOMYRO_TEST_DATABASE_URL,
},async t=>{
  const {Pool}=await import('pg');
  const tag=randomBytes(6).toString('hex'),dbName='domyro_deviceapi_'+tag;
  const source=process.env.DOMYRO_TEST_DATABASE_URL;
  const admin=new Pool({connectionString:source,max:1});
  await admin.query('CREATE DATABASE "'+dbName+'"');
  const target=new URL(source);target.pathname='/'+dbName;
  const db=new Pool({connectionString:target.href,max:2});
  t.after(async()=>{
    await db.end();await admin.query('DROP DATABASE IF EXISTS "'+dbName+'"');
    await admin.end();
  });
  const client=await db.connect();
  try{await applyMigrations(client,await loadMigrations());}
  finally{client.release();}
  const owner=await bootstrapOwner(db,{
    login:'devices-owner',password:'test-owner-password-only-for-ci-2026',
    site:{displayName:'Home'},
  });
  const integration=await createZigbeeIntegrationForAdmin(db,{
    userId:owner.userId,siteId:owner.siteId,baseTopic:'z2m',
  });
  const ieee='0x00158d00018255df';
  await reconcileZigbeeInventory(db,{
    integrationId:integration.id,siteId:owner.siteId,devices:[
      {id:ieee,friendlyName:'living/plug',model:'TEST',vendor:'CI',supported:true},
    ],
  });
  await recordKnownZigbeeObservation(db,{
    integrationId:integration.id,siteId:owner.siteId,externalId:ieee,
    field:'state',value:true,quality:'confirmed',observedAt:new Date().toISOString(),
  });
  const auth=await createLocalAuthService(db,sendJson);
  const server=createDomyroServer({auth});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const route='/api/v1/sites/'+owner.siteId+'/devices';
  assert.equal((await fetch(base+route)).status,401);
  const token=(await createDbSession(db,owner.userId)).token;
  const cookie='domyro_session='+token;
  const headers={cookie};
  const response=await fetch(base+route,{headers});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.readOnly,true);
  assert.equal(data.siteId,owner.siteId);
  assert.equal(data.devices.length,1);
  assert.equal(data.devices[0].ieeeAddress,ieee);
  assert.equal(data.devices[0].friendlyName,'living/plug');
  assert.equal(data.devices[0].observations.state.value,true);
  assert.equal(data.devices[0].observations.state.quality,'confirmed');
  assert.equal(JSON.stringify(data).includes('password_hash'),false);
  assert.equal(JSON.stringify(data).includes('postgresql://'),false);
  assert.equal((await fetch(base+route,{method:'POST',headers:{
    ...headers,origin:base,'content-type':'application/json',
  },body:'{"state":"OFF"}'})).status,403); // CSRF fails even before 405.
  assert.equal((await fetch(base+'/api/v1/sites/not-a-uuid/devices',{headers})).status,404);
  const alien='/api/v1/sites/'+randomUUID()+'/devices';
  const other=await fetch(base+alien,{headers});
  assert.equal(other.status,200);
  assert.deepEqual((await other.json()).devices,[]);
  const guestId=randomUUID();
  await db.query('INSERT INTO domyro_users(id,login,password_hash) VALUES($1,$2,$3)',[
    guestId,'other-member',await hashPassword('isolated-guest-device-password'),
  ]);
  const guestToken=(await createDbSession(db,guestId)).token;
  const hidden=await fetch(base+route,{headers:{cookie:'domyro_session='+guestToken}});
  assert.equal(hidden.status,200);
  assert.deepEqual((await hidden.json()).devices,[]);
  const write=await fetch(base+'/api/v1/sites/'+owner.siteId+'/devices/'+ieee+'/set',{
    method:'POST',headers:{...headers,origin:base},body:'{}',
  });
  assert.equal(write.status,405);
});
