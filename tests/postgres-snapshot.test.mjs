// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { encryptBackupBytes } from '../src/lifecycle/encrypted-backup.mjs';
import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storeEncryptedBackupFile, readEncryptedBackupFile } from '../src/lifecycle/backup-file-store.mjs';
import { loadMigrations, applyMigrations, inspectMigrationState } from '../src/persistence/migrator.mjs';
import {
  createEncryptedPostgresSnapshot,
  verifyEncryptedPostgresSnapshot,
  restoreEncryptedPostgresSnapshotToTestDatabase,
} from '../src/lifecycle/postgres-snapshot.mjs';

const enabled = process.env.DOMYRO_PG_CLI_TEST === '1' && !!process.env.DOMYRO_TEST_DATABASE_URL;
const dockerTools = {
  dump: { executable: 'docker', prefix: ['run', '--rm', '--network=host', '-i', '-e', 'PGPASSWORD', 'postgres:17-alpine', 'pg_dump'] },
  restore: { executable: 'docker', prefix: ['run', '--rm', '--network=host', '-i', '-e', 'PGPASSWORD', 'postgres:17-alpine', 'pg_restore'] },
};

test('actual PostgreSQL 17 encrypted custom archive restores user, site, room, device and observations on a NEW test database', { skip: !enabled }, async t => {
  const base = process.env.DOMYRO_TEST_DATABASE_URL;
  const name = randomBytes(6).toString('hex');
  const sourceName = 'domyro_source_test_' + name;
  const targetName = 'domyro_restore_test_' + name;
  const admin = new Pool({ connectionString: base, max: 2 });
  const urlFor = name => {
    const u = new URL(base);
    u.pathname = '/' + name;
    return u.toString();
  };
  const password = 'isolated-postgres-restore-test-passphrase-only';
  await admin.query('CREATE DATABASE "' + sourceName + '"');
  await admin.query('CREATE DATABASE "' + targetName + '"');
  const sourceUrl = urlFor(sourceName), targetUrl = urlFor(targetName);
  const source = new Pool({ connectionString: sourceUrl, max: 3 });
  try {
    const migrations = await loadMigrations();
    const client = await source.connect();
    try {
      const initialized = await applyMigrations(client, migrations);
      assert.equal(initialized.currentVersion, 3);
    } finally { client.release(); }
    const userId = randomUUID(), siteId = randomUUID(), integrationId = randomUUID(), deviceId = randomUUID();
    const installationId = (await source.query('SELECT id FROM domyro_installations LIMIT 1')).rows[0].id;
    await source.query('INSERT INTO domyro_users(id,login,password_hash) VALUES($1,$2,$3)', [userId,'restore-fixture','hashed-only-test-password-placeholder-123']);
    await source.query('INSERT INTO domyro_sites(id,installation_id,display_name) VALUES($1,$2,$3)',[siteId,installationId,'Backup test home']);
    await source.query("INSERT INTO domyro_site_memberships(site_id,user_id,role) VALUES($1,$2,'owner')",[siteId,userId]);
    await source.query('INSERT INTO domyro_areas(site_id,display_name) VALUES($1,$2)',[siteId,'Living Room']);
    await source.query("INSERT INTO domyro_integrations(id,site_id,protocol,display_name,base_topic) VALUES($1,$2,'zigbee2mqtt','Test Integration','zigbee2mqtt')",[integrationId,siteId]);
    await source.query("INSERT INTO domyro_devices(id,site_id,integration_id,external_id,friendly_name,supported) VALUES($1,$2,$3,'0x00158d00018255df','test-plug',true)",[deviceId,siteId,integrationId]);
    await source.query("INSERT INTO domyro_observations(device_id,field,value_json,quality,observed_at) VALUES($1,'state','true'::jsonb,'confirmed','2026-11-01T12:00:00Z')",[deviceId]);
    const originalCounts = await source.query("SELECT (SELECT count(*)::int FROM domyro_users) AS users, (SELECT count(*)::int FROM domyro_sites) AS sites,(SELECT count(*)::int FROM domyro_areas) AS areas,(SELECT count(*)::int FROM domyro_devices) AS devices,(SELECT count(*)::int FROM domyro_observations) AS observations");
    assert.deepEqual(originalCounts.rows[0],{users:1,sites:1,areas:1,devices:1,observations:1});

    const snapshot = await createEncryptedPostgresSnapshot({ sourceUrl, password, tools: dockerTools });
    assert.equal(snapshot.restorable, false);
    const backupDirectory = await mkdtemp(join(tmpdir(),'domyro-complete-db-backup-'));
    t.after(() => rm(backupDirectory,{recursive:true,force:true}));
    await storeEncryptedBackupFile({ directory:backupDirectory,name:'pg-fixture.domyrobackup',encrypted:snapshot.encrypted });
    const storedBytes = await readEncryptedBackupFile({ directory:backupDirectory,name:'pg-fixture.domyrobackup' });
    assert.deepEqual(storedBytes,snapshot.encrypted);
    assert.equal(snapshot.encrypted.subarray(0,8).toString(), 'DOMYROB1');
    const verified = await verifyEncryptedPostgresSnapshot(snapshot.encrypted, password);
    assert.equal(verified.archive.subarray(0,5).toString(), 'PGDMP');
    assert.equal(snapshot.metadata.archiveSha256, verified.metadata.archiveSha256);
    await assert.rejects(() => verifyEncryptedPostgresSnapshot(snapshot.encrypted,'incorrect-passphrase-with-adequate-length'), /backup_authentication_failed/);
    const corrupt = Buffer.from(snapshot.encrypted);
    corrupt[corrupt.length-18] ^= 1;
    await assert.rejects(() => verifyEncryptedPostgresSnapshot(corrupt,password), /backup_authentication_failed/);

    // Failure injection: a correctly encrypted and checksummed container with
    // an invalid PG custom archive MUST fail before committing any tables.
    const invalidArchive = Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(40)]);
    const invalidEnvelope = Buffer.from(JSON.stringify({
      metadata: {
        schemaVersion:1,format:'postgresql-custom',databaseSchemaScope:'public',
        archiveSha256:createHash('sha256').update(invalidArchive).digest('hex'),
        archiveBytes:invalidArchive.length,createdAt:new Date().toISOString(),
      },
      archiveBase64:invalidArchive.toString('base64'),
    }));
    const failedRestore = await encryptBackupBytes(invalidEnvelope,password);
    await assert.rejects(() => restoreEncryptedPostgresSnapshotToTestDatabase({
      encrypted:failedRestore,password,targetUrl,tools:dockerTools,
    }), /postgres_tool_failed/);
    const emptyAfterFailure = new Pool({connectionString:targetUrl,max:1});
    try {
      const result = await emptyAfterFailure.query([
        'SELECT count(*)::int AS n FROM pg_catalog.pg_class c',
        'JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace',
        "WHERE ns.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')",
      ].join(' '));
      assert.equal(result.rows[0].n,0);
    } finally { await emptyAfterFailure.end(); }

    const restored = await restoreEncryptedPostgresSnapshotToTestDatabase({
      encrypted:storedBytes,password,targetUrl,tools:dockerTools,
    });
    assert.equal(restored.verifiedRestore,true);
    assert.equal(restored.schemaVersion,3);
    const target = new Pool({ connectionString: targetUrl, max: 2 });
    try {
      const c = await target.connect();
      try { assert.equal((await inspectMigrationState(c, migrations)).ready,true); }
      finally { c.release(); }
      const counts = await target.query("SELECT (SELECT count(*)::int FROM domyro_users) AS users, (SELECT count(*)::int FROM domyro_sites) AS sites,(SELECT count(*)::int FROM domyro_areas) AS areas,(SELECT count(*)::int FROM domyro_devices) AS devices,(SELECT count(*)::int FROM domyro_observations) AS observations");
      assert.deepEqual(counts.rows[0],originalCounts.rows[0]);
      const state = await target.query('SELECT d.external_id,o.value_json,o.quality FROM domyro_observations o JOIN domyro_devices d ON d.id=o.device_id');
      assert.equal(state.rows[0].external_id,'0x00158d00018255df');
      assert.equal(state.rows[0].value_json,true);
      assert.equal(state.rows[0].quality,'confirmed');
      assert.equal((await target.query('SELECT password_hash FROM domyro_users WHERE id=$1',[userId])).rows[0].password_hash,'hashed-only-test-password-placeholder-123');
    } finally { await target.end(); }
    await assert.rejects(() => restoreEncryptedPostgresSnapshotToTestDatabase({ encrypted:snapshot.encrypted,password,targetUrl,tools:dockerTools }), /restore_target_not_empty/);
    await assert.rejects(() => restoreEncryptedPostgresSnapshotToTestDatabase({ encrypted:snapshot.encrypted,password,targetUrl:sourceUrl,tools:dockerTools }), /restore_target_must_be_disposable_test_database/);
    await assert.rejects(() => restoreEncryptedPostgresSnapshotToTestDatabase({ encrypted:corrupt,password,targetUrl:sourceUrl,tools:dockerTools }), /restore_target_must_be_disposable_test_database/);
  } finally {
    await source.end();
    // Only the disposable databases created by this test are removed.
    await admin.query('DROP DATABASE IF EXISTS "' + targetName + '"');
    await admin.query('DROP DATABASE IF EXISTS "' + sourceName + '"');
    await admin.end();
  }
});

test('restore is fail-closed for ambiguous or missing targets without invoking pg_restore', async () => {
  const bogusTools = { dump: dockerTools.dump, restore: { executable: 'this-must-not-run', prefix: [] } };
  await assert.rejects(() => restoreEncryptedPostgresSnapshotToTestDatabase({
    encrypted:Buffer.from('invalid'),password:'some-sufficiently-long-password',
    targetUrl:'postgresql://user:password@127.0.0.1:5432/domyro', tools:bogusTools,
  }), /restore_target_must_be_disposable_test_database/);
  await assert.rejects(() => createEncryptedPostgresSnapshot({
    sourceUrl:'postgresql://user:password@192.168.0.1:5432/domyro',password:'some-sufficiently-long-password',
  }), /isolated_local_database_required/);
});
