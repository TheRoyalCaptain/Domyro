// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
