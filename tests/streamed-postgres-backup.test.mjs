// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import {createEncryptedConfigFixture} from '../src/lifecycle/config-fixture-backup.mjs';
import {restoreConfigFixtureToScratch} from '../src/lifecycle/config-fixture-restore.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encryptStreamToPrivateFile } from '../src/lifecycle/streamed-backup.mjs';
import { registerVerifiedPostgresBackup, inspectLocalBackupCatalog, catalogRetentionSuggestions } from '../src/lifecycle/backup-catalog.mjs';
import { Pool } from 'pg';
import { applyMigrations, loadMigrations } from '../src/persistence/migrator.mjs';
import { dumpPostgresToStreamedBackup, restoreStreamedBackupToTestDatabase } from '../src/lifecycle/streamed-postgres-backup.mjs';

const enabled=process.env.DOMYRO_PG_CLI_TEST==='1'&&!!process.env.DOMYRO_TEST_DATABASE_URL;
const tools={
  dump:{executable:'docker',prefix:['run','--rm','--network=host','-i','-e','PGPASSWORD','postgres:17-alpine','pg_dump']},
  restore:{executable:'docker',prefix:['run','--rm','--network=host','-i','-e','PGPASSWORD','postgres:17-alpine','pg_restore']},
};
test('real PostgreSQL streaming dump, encrypted file, authenticated scratch restore and no in-place overwrite', {skip:!enabled},async t=>{
  const base=process.env.DOMYRO_TEST_DATABASE_URL;
  const tag=randomBytes(6).toString('hex');
  const sourceName='domyro_stream_source_'+tag,targetName='domyro_restore_test_'+tag;
  const urlFor=name=>{const u=new URL(base);u.pathname='/'+name;return u.toString();};
  const admin=new Pool({connectionString:base,max:2});
  const dir=await mkdtemp(join(tmpdir(),'domyro-stream-pg-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await admin.query('CREATE DATABASE "'+sourceName+'"');
  await admin.query('CREATE DATABASE "'+targetName+'"');
  const sourceUrl=urlFor(sourceName),targetUrl=urlFor(targetName);
  const source=new Pool({connectionString:sourceUrl,max:2});
  const passphrase='temporary-ci-streaming-postgres-passphrase';
  try {
    const c=await source.connect();
    try{await applyMigrations(c,await loadMigrations());}finally{c.release();}
    const uid=randomUUID(),siteId=randomUUID();
    const installId=(await source.query('SELECT id FROM domyro_installations LIMIT 1')).rows[0].id;
    await source.query('INSERT INTO domyro_users(id,login,password_hash) VALUES($1,$2,$3)',
      [uid,'stream-owner','synthetic-development-password-hash-000']);
    await source.query('INSERT INTO domyro_sites(id,installation_id,display_name) VALUES($1,$2,$3)',
      [siteId,installId,'Streamed Backup Home']);
    await source.query("INSERT INTO domyro_site_memberships(site_id,user_id,role) VALUES($1,$2,'owner')",
      [siteId,uid]);
    await source.query('INSERT INTO domyro_areas(site_id,display_name) VALUES($1,$2)',[siteId,'Garage']);
    const original=(await source.query('SELECT id,display_name FROM domyro_sites WHERE id=$1',[siteId])).rows[0];
    const saved=await dumpPostgresToStreamedBackup({
      sourceUrl,directory:dir,name:'real-pg-stream.domyrobackup',password:passphrase,tools,
    });
    assert.equal(saved.format,'DOMYROS2');
    assert.ok(saved.plaintextBytes>1000);
    assert.equal(saved.restorable,false);
    assert.deepEqual(await readdir(dir),['real-pg-stream.domyrobackup']);
    const receipt = await registerVerifiedPostgresBackup({
      directory:dir,name:'real-pg-stream.domyrobackup',password:passphrase,
    });
    assert.equal(receipt.encryptedSha256.length,64);
    const catalog = await inspectLocalBackupCatalog({directory:dir,password:passphrase});
    assert.equal(catalog.length,1);
    assert.equal(catalog[0].authenticated,true);
    assert.equal(catalog[0].verified,false); // Actual restore proof not recorded in catalogue.
    assert.deepEqual(catalogRetentionSuggestions(catalog).proposedRemovals,[]);
    await assert.rejects(()=>dumpPostgresToStreamedBackup({
      sourceUrl,directory:dir,name:'real-pg-stream.domyrobackup',password:passphrase,tools,
    }),/EEXIST/);
    await assert.rejects(()=>restoreStreamedBackupToTestDatabase({
      directory:dir,name:'real-pg-stream.domyrobackup',password:'incorrect-secret-of-sufficient-length',targetUrl,tools,
    }),/backup_authentication_failed/);
    const stillEmpty=new Pool({connectionString:targetUrl,max:1});
    try {
      assert.equal((await stillEmpty.query("SELECT to_regclass('public.domyro_users') IS NULL AS empty")).rows[0].empty,true);
    } finally {await stillEmpty.end();}
    const restored=await restoreStreamedBackupToTestDatabase({
      directory:dir,name:'real-pg-stream.domyrobackup',password:passphrase,targetUrl,tools,
    });
    assert.equal(restored.verifiedRestore,true);
    assert.equal(restored.schemaVersion,3);
    assert.equal(restored.archiveSha256,saved.sha256);
    const target=new Pool({connectionString:targetUrl,max:1});
    try {
      const dbRow=(await target.query('SELECT id,display_name FROM domyro_sites WHERE id=$1',[siteId])).rows[0];
      assert.deepEqual(dbRow,original);
      assert.equal((await target.query("SELECT display_name FROM domyro_areas WHERE site_id=$1",[siteId])).rows[0].display_name,'Garage');
      assert.equal((await target.query('SELECT login FROM domyro_users WHERE id=$1',[uid])).rows[0].login,'stream-owner');
    }finally{await target.end();}
    // Additional disconnected proof: a separately captured encrypted config
    // fixture can be restored alongside this disposable PostgreSQL database.
    // This is NOT coordinated full-system crash recovery.
    const configRoot=await mkdtemp(join(tmpdir(),'domyro-combined-config-'));
    const scratchParent=await mkdtemp(join(tmpdir(),'domyro-combined-restore-'));
    t.after(async()=>{
      await rm(configRoot,{recursive:true,force:true});
      await rm(scratchParent,{recursive:true,force:true});
    });
    await writeFile(join(configRoot,'core.json'), '{"fixture":"only","token":"disposable"}',{mode:0o600});
    await writeFile(join(configRoot,'mosquitto.conf'), 'listener 1883 localhost',{mode:0o600});
    await createEncryptedConfigFixture({
      root:configRoot,directory:dir,name:'combined-config.domyrobackup',password:passphrase,
      files:[{role:'domyro_core',name:'core.json'},{role:'mosquitto',name:'mosquitto.conf'}],
    });
    const configResult=await restoreConfigFixtureToScratch({
      backupDirectory:dir,backupName:'combined-config.domyrobackup',password:passphrase,
      scratchParent,targetName:'domyro_restore_test_abcdef123456',
    });
    assert.equal(configResult.scratchRestored,true);
    assert.equal(configResult.productionRestoreApproved,false);
    assert.equal((await readFile(join(scratchParent,'domyro_restore_test_abcdef123456','domyro_core','core.json'),'utf8')),
      '{"fixture":"only","token":"disposable"}');
    assert.equal((await readFile(join(scratchParent,'domyro_restore_test_abcdef123456','mosquitto','mosquitto.conf'),'utf8')),
      'listener 1883 localhost');
    await assert.rejects(()=>restoreStreamedBackupToTestDatabase({
      directory:dir,name:'real-pg-stream.domyrobackup',password:passphrase,targetUrl,tools,
    }),/restore_target_not_empty/);
    await assert.rejects(()=>restoreStreamedBackupToTestDatabase({
      directory:dir,name:'real-pg-stream.domyrobackup',password:passphrase,targetUrl:sourceUrl,tools,
    }),/restore_target_must_be_disposable_test_database/);
  }finally{
    await source.end();
    await admin.query('DROP DATABASE IF EXISTS "'+targetName+'"');
    await admin.query('DROP DATABASE IF EXISTS "'+sourceName+'"');
    await admin.end();
  }
});


test('failed pg_dump and authenticated non-Postgres archive cannot publish or restore',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'domyro-failed-dump-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const sourceUrl='postgresql://dev:temporary-password@127.0.0.1:5432/nonproduction',
    targetUrl='postgresql://dev:temporary-password@127.0.0.1:5432/domyro_restore_test_abcdef1234',
    password='only-isolated-development-backup-secret';
  const broken={
    dump:{executable:process.execPath,prefix:['-e',"process.stdout.write('PGDMP incomplete'); process.exit(9);"]},
    restore:{executable:'never-invoked',prefix:[]},
  };
  await assert.rejects(()=>dumpPostgresToStreamedBackup({
    sourceUrl,directory:dir,name:'failed-pg.domyrobackup',password,tools:broken,
  }),/postgres_tool_failed/);
  assert.deepEqual(await readdir(dir),[]);
  await encryptStreamToPrivateFile({
    source:Readable.from([Buffer.from('HELLO this-is-authenticated-nonpg')]),
    directory:dir,name:'not-pg.domyrobackup',password,
  });
  await assert.rejects(()=>restoreStreamedBackupToTestDatabase({
    directory:dir,name:'not-pg.domyrobackup',password,targetUrl,tools:broken,
  }),/not_a_postgresql_custom_archive/);
  assert.deepEqual(await readdir(dir),['not-pg.domyrobackup']);
});
