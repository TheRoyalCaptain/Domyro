// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, lstat, symlink, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptBackupBytes, decryptBackupBytes } from '../src/lifecycle/encrypted-backup.mjs';
import { storeEncryptedBackupFile, readEncryptedBackupFile } from '../src/lifecycle/backup-file-store.mjs';

test('fsynced encrypted backup is stored privately and never overwrites an existing snapshot', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'domyro-backup-files-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const secret = 'snapshot-file-test-passphrase-only';
  const first = await encryptBackupBytes(Buffer.from('only a disposable test fixture'),secret);
  const name = 'first-snapshot.domyrobackup';
  const stored = await storeEncryptedBackupFile({directory:dir,name,encrypted:first});
  assert.equal(stored.created,true);
  assert.equal(stored.bytes,first.length);
  const file = join(dir,name);
  const st = await lstat(file);
  assert.equal(st.isFile(),true);
  assert.equal(st.mode & 0o077,0);
  assert.deepEqual(await readEncryptedBackupFile({directory:dir,name}),first);
  assert.equal((await decryptBackupBytes(await readEncryptedBackupFile({directory:dir,name}),secret)).toString(),'only a disposable test fixture');
  const second = await encryptBackupBytes(Buffer.from('must not replace earlier backup'),secret);
  await assert.rejects(() => storeEncryptedBackupFile({directory:dir,name,encrypted:second}),/EEXIST/);
  assert.deepEqual(await readFile(file),first);

  // An existing symlink is also a collision, never a legitimate backup target.
  const symlinkPath = join(dir,'symlink-snapshot.domyrobackup');
  await symlink(file,symlinkPath);
  await assert.rejects(() => storeEncryptedBackupFile({
    directory:dir,name:'symlink-snapshot.domyrobackup',encrypted:second,
  }),/EEXIST/);
  await assert.rejects(() => readEncryptedBackupFile({
    directory:dir,name:'symlink-snapshot.domyrobackup',
  }),/backup_file_untrusted/);
  await assert.rejects(() => storeEncryptedBackupFile({
    directory:dir,name:'../escape.domyrobackup',encrypted:second,
  }),/unsafe_backup_filename/);
  await assert.rejects(() => storeEncryptedBackupFile({
    directory:dir,name:'plain.domyrobackup',encrypted:Buffer.from('unencrypted'),
  }),/encrypted_backup_bytes_invalid/);
  await chmod(file,0o644);
  await assert.rejects(() => readEncryptedBackupFile({directory:dir,name}),/backup_file_untrusted/);
});
test('backup store rejects public directories and symlink directories', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'domyro-backup-private-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const blob = await encryptBackupBytes(Buffer.from('small fixture'), 'backup-test-secret-long-enough');
  const linkName = join(dir,'alias');
  await symlink(dir,linkName);
  await assert.rejects(() => storeEncryptedBackupFile({
    directory:linkName,name:'test1.domyrobackup',encrypted:blob,
  }),/backup_directory_must_be_private/);
  await chmod(dir,0o755);
  await assert.rejects(() => storeEncryptedBackupFile({
    directory:dir,name:'test1.domyrobackup',encrypted:blob,
  }),/backup_directory_must_be_private/);
});
