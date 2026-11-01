// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createEncryptedConfigFixture} from '../src/lifecycle/config-fixture-backup.mjs';
import {restoreConfigFixtureToScratch,inspectScratchConfigRestore} from '../src/lifecycle/config-fixture-restore.mjs';
import {encryptStreamToPrivateFile} from '../src/lifecycle/streamed-backup.mjs';

const pass='isolated-config-recovery-dev-only-password';
async function setup(t){
  const root=await mkdtemp(join(tmpdir(),'domyro-config-original-'));
  const backupDirectory=await mkdtemp(join(tmpdir(),'domyro-config-cipher-'));
  const scratchParent=await mkdtemp(join(tmpdir(),'domyro-config-scratch-'));
  t.after(async()=>{
    for(const x of [root,backupDirectory,scratchParent])await rm(x,{recursive:true,force:true});
  });
  const fixture={
    'settings.json':Buffer.from('{"home":"Test","apiKey":"never-print-this-fixture-secret"}'),
    'broker.conf':Buffer.from('listener 1883 localhost\npassword_file test-fixture-only\n'),
    'z2m.yaml':Buffer.from('homeassistant: false\nfrontend: false\nsecret: fixture-only\n'),
  };
  for(const [name,bytes] of Object.entries(fixture))await writeFile(join(root,name),bytes,{mode:0o600});
  await createEncryptedConfigFixture({
    root,directory:backupDirectory,name:'config-fixture.domyrobackup',password:pass,
    files:[
      {role:'domyro_core',name:'settings.json'},
      {role:'mosquitto',name:'broker.conf'},
      {role:'zigbee2mqtt',name:'z2m.yaml'},
    ],
  });
  return {root,backupDirectory,scratchParent,fixture};
}
const options=env=>({
  backupDirectory:env.backupDirectory,backupName:'config-fixture.domyrobackup',
  scratchParent:env.scratchParent,password:pass,targetName:'domyro_restore_test_abcdef1234',
});
test('fully authenticated config archive restores selected file bytes into NEW private scratch installation',async t=>{
  const env=await setup(t),cfg=options(env);
  const result=await restoreConfigFixtureToScratch(cfg);
  assert.equal(result.scratchRestored,true);
  assert.equal(result.productionRestoreApproved,false);
  assert.equal(result.fileCount,3);
  assert.deepEqual(result.componentRoles,['domyro_core','mosquitto','zigbee2mqtt']);
  const target=join(env.scratchParent,cfg.targetName);
  const expected=[
    ['domyro_core','settings.json'],
    ['mosquitto','broker.conf'],
    ['zigbee2mqtt','z2m.yaml'],
  ];
  for(const [role,name] of expected){
    const path=join(target,role,name),actual=await readFile(path);
    assert.deepEqual(actual,env.fixture[name]);
    assert.equal((await stat(path)).mode&0o077,0);
    assert.equal((await stat(join(target,role))).mode&0o077,0);
    assert.deepEqual(await readFile(join(env.root,name)),env.fixture[name]);
  }
  const marker=JSON.parse(await readFile(join(target,'RESTORE_VERIFIED.json'),'utf8'));
  assert.equal(marker.developmentOnly,true);
  assert.equal(marker.complete,true);
  assert.equal(marker.files.length,3);
  assert.equal(marker.files[0].sha256,createHash('sha256').update(env.fixture['settings.json']).digest('hex'));
  assert.equal((await stat(target)).mode&0o077,0);
  const checked=await inspectScratchConfigRestore({scratchParent:env.scratchParent,targetName:cfg.targetName});
  assert.equal(checked.scratchFilesMatchManifest,true);
  assert.equal(checked.productionRestoreApproved,false);
  await assert.rejects(()=>restoreConfigFixtureToScratch(cfg),/EEXIST/);
  assert.deepEqual(await readFile(join(target,'domyro_core','settings.json')),env.fixture['settings.json']);
});
test('wrong password and a pre-existing target never create or overwrite a scratch installation',async t=>{
  const env=await setup(t),cfg=options(env);
  await assert.rejects(()=>restoreConfigFixtureToScratch({...cfg,password:'incorrect-long-passphrase'}),/backup_authentication_failed/);
  assert.deepEqual(await readdir(env.scratchParent),[]);
  await writeFile(join(env.scratchParent,cfg.targetName),'existing-user-data',{mode:0o600});
  await assert.rejects(()=>restoreConfigFixtureToScratch(cfg),/EEXIST/);
  assert.equal((await readFile(join(env.scratchParent,cfg.targetName),'utf8')),'existing-user-data');
  await assert.rejects(()=>restoreConfigFixtureToScratch({...cfg,targetName:'../../production'}),/restore_target_must_be_disposable_test_directory/);
});
test('injected mid-write error removes own partial directory and NEVER creates completion marker',async t=>{
  const env=await setup(t),cfg=options(env);
  await assert.rejects(()=>restoreConfigFixtureToScratch({
    ...cfg,beforeWrite:async i=>{if(i===1)throw new Error('simulated-disk-failure');},
  }),/simulated-disk-failure/);
  assert.deepEqual(await readdir(env.scratchParent),[]);
  const okay=await restoreConfigFixtureToScratch(cfg);
  assert.equal(okay.fileCount,3);
});
test('symlink target and unsafe scratch parent are never written to',async t=>{
  const env=await setup(t),cfg=options(env);
  const dest=join(env.scratchParent,cfg.targetName);
  await symlink(env.root,dest);
  await assert.rejects(()=>restoreConfigFixtureToScratch(cfg),/EEXIST/);
  assert.equal((await readFile(join(env.root,'settings.json'),'utf8')).includes('never-print-this'),true);
  await assert.rejects(()=>restoreConfigFixtureToScratch({...cfg,scratchParent:dest}),/scratch_parent_must_be_private/);
});
test('authenticated but malformed fixture entries cannot create scratch target',async t=>{
  const env=await setup(t),cfg=options(env);
  const badName='invalid-config.domyrobackup';
  const invalid={
    schemaVersion:1,format:'domyro-selected-config-fixture',
    files:[{role:'domyro_core',name:'../outside.json',sha256:'a'.repeat(64),bytes:10,base64:'YWJjZA=='}],
  };
  await encryptStreamToPrivateFile({
    source:Readable.from([Buffer.concat([Buffer.from('DOMCONF1\n'),Buffer.from(JSON.stringify(invalid))])]),
    directory:env.backupDirectory,name:badName,password:pass,
  });
  await assert.rejects(()=>restoreConfigFixtureToScratch({...cfg,backupName:badName}),/restore_config_entry_invalid/);
  assert.deepEqual(await readdir(env.scratchParent),[]);
});


test('post-restoration audit refuses changed files and incomplete or fabricated markers',async t=>{
  const env=await setup(t),cfg=options(env);
  await restoreConfigFixtureToScratch(cfg);
  const root=join(env.scratchParent,cfg.targetName);
  const altered=join(root,'domyro_core','settings.json');
  await writeFile(altered,'{"home":"tampered"}',{mode:0o600});
  await assert.rejects(()=>inspectScratchConfigRestore({scratchParent:env.scratchParent,targetName:cfg.targetName}),
    /scratch_restore_file_digest_mismatch/);
  await writeFile(altered,env.fixture['settings.json'],{mode:0o600});
  await writeFile(join(root,'domyro_core','unexpected.txt'),'not from backup',{mode:0o600});
  await assert.rejects(()=>inspectScratchConfigRestore({scratchParent:env.scratchParent,targetName:cfg.targetName}),
    /scratch_restore_extra_files/);
});
