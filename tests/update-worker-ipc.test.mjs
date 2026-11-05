// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request} from 'node:http';
import {createUpdateWorkerServer,createUpdateWorkerClient} from '../src/lifecycle/update-worker-ipc.mjs';

test('Unix worker only accepts bounded version requests, rejects concurrent jobs and honors gate',async t=>{
  const root=await mkdtemp(join(tmpdir(),'domyro-ipc-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let allowed=false,finish,installed=[];
  const server=createUpdateWorkerServer({
    authorize:async()=>{if(!allowed)throw Error('closed');},currentVersion:async()=>'0.1.0',
    job:{status:async()=>({busy:!!finish,recoveryRequired:false,job:null}),
      install:v=>{installed.push(v);return new Promise(resolve=>{finish=resolve;});}},
  });
  const socket=join(root,'worker.sock');let address={socketPath:socket};
  try {server.listen(socket);await once(server,'listening');}
  catch(e) {
    if(e.code!=='EPERM'||process.env.GITHUB_ACTIONS==='true')throw e;
    t.diagnostic('Sandbox denies Unix sockets; exercising protocol over loopback. CI requires a real Unix socket.');
    server.listen(0,'127.0.0.1');await once(server,'listening');
    address={host:'127.0.0.1',port:server.address().port};
  }
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const call=(path,body,method='POST')=>new Promise((resolve,reject)=>{
    const req=request({...address,path,method,headers:{'content-type':'application/json'}},res=>{
      let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({code:res.statusCode,body:JSON.parse(data)}));
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  assert.equal((await call('/status',undefined,'GET')).body.installAllowed,false);
  assert.equal((await call('/install',{version:'0.1.1'})).code,423);
  allowed=true;
  assert.equal((await call('/install',{version:'../command'})).code,400);
  assert.equal((await call('/install',{version:'0.1.1',command:'rm'})).code,400);
  assert.equal((await call('/install',{version:'x'.repeat(2048)})).code,413);
  assert.equal((await call('/shell',{version:'0.1.1'})).code,404);
  assert.equal((await call('/install',{version:'0.1.1'})).code,202);
  assert.equal((await call('/install',{version:'0.1.2'})).code,409);
  assert.deepEqual(installed,['0.1.1']);finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.throws(()=>createUpdateWorkerClient('https://host/shell'),/socket_invalid/);
  assert.throws(()=>createUpdateWorkerClient('/run/../tmp/socket.sock'),/socket_invalid/);
});
