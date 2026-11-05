// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNativeUpdateJob} from '../src/lifecycle/native-update-job.mjs';

async function fixture(t,fail=null) {
  const root=await mkdtemp(join(tmpdir(),'domyro-update-job-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[];
  let version='0.1.0',snapshot=null,data={rooms:['Woonkamer']};
  const host={};
  const operations={
    authorize:()=>{},currentVersion:()=>version,prepare:()=>{},stop:()=>{},
    backup:()=>{snapshot=structuredClone(data);},
    activate:r=>{version=r.version;data.rooms.push('candidate startup');},
    start:()=>{},resume:()=>{},healthy:v=>version===v,
    restore:r=>{version=r.previousVersion;data=structuredClone(snapshot);},
  };
  for(const [name,fn] of Object.entries(operations))host[name]=async(...args)=>{
    calls.push(name);
    if(fail===name)throw Error('injected_'+name);
    return fn(...args);
  };
  const job=await createNativeUpdateJob({root,host});
  return {job,root,host,calls,version:()=>version,data:()=>data};
}
test('signed-update orchestration commits only after stopped backup and target-version health',async t=>{
  const f=await fixture(t);
  assert.equal((await f.job.install('0.1.1')).state,'installed');
  assert.deepEqual(f.calls,['authorize','currentVersion','prepare','stop','backup','activate','start','healthy','resume']);
  assert.equal((await f.job.status()).job.phase,'committed');
  assert.equal((await f.job.status()).recoveryRequired,false);
  assert.ok(!(await readdir(f.root)).includes('pending.json'));
  assert.equal(await f.job.recover(),null);
});
test('download/verification failure does not stop the working application',async t=>{
  const f=await fixture(t,'prepare');
  await assert.rejects(f.job.install('0.1.1'),/injected_prepare/);
  assert.ok(!f.calls.includes('stop'));
  assert.equal(f.version(),'0.1.0');
  assert.equal((await f.job.status()).recoveryRequired,false);
});
test('backup failure restarts previous app without attempting an unverified data restore',async t=>{
  const f=await fixture(t,'backup');
  await assert.rejects(f.job.install('0.1.1'),/injected_backup/);
  assert.ok(!f.calls.includes('activate'));
  assert.ok(!f.calls.includes('restore'));
  assert.equal((await f.job.status()).job.phase,'recovered');
});
test('failed candidate restores both previous version and snapshot data',async t=>{
  const f=await fixture(t);
  const healthy=f.host.healthy;
  f.host.healthy=async v=>v==='0.1.1'?false:healthy(v);
  await assert.rejects(f.job.install('0.1.1'),/update_health_failed/);
  assert.equal(f.version(),'0.1.0');
  assert.deepEqual(f.data(),{rooms:['Woonkamer']});
  assert.equal((await f.job.status()).job.phase,'recovered');
});
test('failed recovery retains journal and refuses a second update',async t=>{
  const f=await fixture(t,'restore');
  const healthy=f.host.healthy;
  f.host.healthy=async v=>v==='0.1.1'?false:healthy(v);
  await assert.rejects(f.job.install('0.1.1'),/recovery_required/);
  assert.equal((await f.job.status()).recoveryRequired,true);
  const before=await readFile(join(f.root,'pending.json'),'utf8');
  await assert.rejects(f.job.install('0.1.2'),/recovery_required/);
  assert.equal(await readFile(join(f.root,'pending.json'),'utf8'),before);
});
test('concurrent request and version replay cannot start another transaction',async t=>{
  const f=await fixture(t);
  let release;
  f.host.prepare=()=>new Promise(resolve=>{release=resolve;});
  const installing=f.job.install('0.1.1');
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.job.install('0.1.2'),/busy/);
  await assert.rejects(f.job.recover(),/busy/);
  release();await installing;
  await assert.rejects(f.job.install('0.1.1'),/not_newer/);
  await assert.rejects(f.job.install('../../etc'),/version_invalid/);
});
for(const phase of ['preparing','stopping','backing_up','committed']) {
  test('worker restart resolves durable '+phase+' journal without guessing paths',async t=>{
    const f=await fixture(t);
    const record={schemaVersion:1,id:randomUUID(),version:'0.1.1',previousVersion:'0.1.0',
      phase,backupVerified:phase==='committed',restoreRequired:phase==='committed',updatedAt:new Date().toISOString()};
    await writeFile(join(f.root,'pending.json'),JSON.stringify(record),{mode:0o600});
    await f.job.recover();
    assert.equal((await f.job.status()).recoveryRequired,false);
    assert.equal((await f.job.status()).job.phase,phase==='committed'?'committed':'recovered');
    assert.ok(!f.calls.includes('restore'));
    if(phase==='committed')assert.deepEqual(f.calls,['resume']);
  });
}
test('untrusted journal permissions and closed authorization prevent host changes',async t=>{
  const f=await fixture(t,'authorize');
  await assert.rejects(f.job.install('0.1.1'),/injected_authorize/);
  assert.deepEqual(f.calls,['authorize']);
  await writeFile(join(f.root,'pending.json'),'{}',{mode:0o600});
  await chmod(join(f.root,'pending.json'),0o644);
  await assert.rejects(f.job.recover(),/journal_unsafe/);
});
