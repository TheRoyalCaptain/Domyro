// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDomyroServer} from '../src/server.mjs';
import {sendJson} from '../src/lib/http.mjs';
import {createLocalAuthService} from '../src/security/http-auth.mjs';
import {generateSessionToken,hashSessionToken} from '../src/security/credentials.mjs';

test('portal update request requires session, same origin, CSRF and system administrator before IPC',async t=>{
  const token=generateSessionToken(),userId=randomUUID(),sessionId=randomUUID();
  let administrator=true,calls=0,gateOpen=true,maintenance=false;
  const db={query:async(sql,args)=>{
    if(sql.includes('FROM domyro_sessions s'))return args[0].equals(hashSessionToken(token))
      ?{rowCount:1,rows:[{session_id:sessionId,user_id:userId}]}:{rowCount:0,rows:[]};
    if(sql.includes('FROM domyro_site_memberships m'))return {rowCount:administrator?1:0,rows:[]};
    if(sql.includes('SELECT login'))return {rowCount:1,rows:[{login:'test-owner'}]};
    throw Error('unexpected database query');
  }};
  const updateExecutor={status:async()=>({installAllowed:gateOpen,workerAvailable:true}),
    install:async version=>{calls++;if(!gateOpen){const e=Error('closed');e.status=423;throw e;}
      return {state:'queued',version};}};
  const auth=await createLocalAuthService(db,sendJson,{updateExecutor});
  const server=createDomyroServer({auth,maintenanceCheck:async()=>maintenance});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port,cookie='domyro_session='+token;
  const me=await fetch(base+'/api/v1/auth/me',{headers:{cookie}});
  const csrf=(await me.json()).csrfToken;
  const install=(overrides={},body={version:'0.1.1'})=>fetch(base+'/api/v1/system/updates/install',{
    method:'POST',headers:{origin:base,cookie,'x-domyro-csrf':csrf,'content-type':'application/json',...overrides},
    body:JSON.stringify(body)});
  assert.equal((await install({cookie:''})).status,401);
  assert.equal((await install({origin:'http://attacker.invalid'})).status,403);
  assert.equal((await install({'x-domyro-csrf':''})).status,403);
  administrator=false;assert.equal((await install()).status,403);administrator=true;
  assert.equal((await install({},{version:'../shell'})).status,400);
  assert.equal(calls,0);
  const accepted=await install();assert.equal(accepted.status,202);
  assert.deepEqual(await accepted.json(),{state:'queued',version:'0.1.1'});
  gateOpen=false;assert.equal((await install()).status,423);
  assert.equal(calls,2);
  maintenance=true;
  assert.equal((await install()).status,503);
  assert.equal(calls,2);
  assert.equal((await fetch(base+'/api/v1/system/updates',{headers:{cookie}})).status,200);
  maintenance=false;assert.equal((await install()).status,423);
});
