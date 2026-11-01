// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, rm, open, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptStreamToPrivateFile } from '../src/lifecycle/streamed-backup.mjs';
import { registerVerifiedPostgresBackup, inspectLocalBackupCatalog, catalogRetentionSuggestions } from '../src/lifecycle/backup-catalog.mjs';

const pass = 'isolated-catalog-cryptographic-test-passphrase';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'domyro-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function fakeEncryptedPg(directory, name) {
  const plain = Buffer.concat([Buffer.from('PGDMP'), randomBytes(4096)]);
  await encryptStreamToPrivateFile({ directory, name, password: pass, source: Readable.from([plain]) });
}
test('immutable receipts require fresh authenticated read and never imply a tested restore', async t => {
  const directory = await fixture(t), name = 'fixture-one.domyrobackup';
  await fakeEncryptedPg(directory, name);
  const initially = await inspectLocalBackupCatalog({ directory });
  assert.equal(initially[0].verified, false);
  assert.equal(initially[0].owned, false);
  assert.equal(initially[0].reason, 'invalid_or_missing_receipt_or_backup');
  const receipt = await registerVerifiedPostgresBackup({
    directory, name, password: pass, completedAt: '2026-11-01T12:00:00Z',
  });
  assert.equal(receipt.kind, 'postgresql-custom');
  assert.equal(receipt.plaintextSha256.length, 64);
  assert.equal(receipt.encryptedSha256.length, 64);
  await assert.rejects(() => registerVerifiedPostgresBackup({ directory, name, password: pass }), /EEXIST/);
  const noPass = await inspectLocalBackupCatalog({ directory });
  assert.equal(noPass[0].reason, 'authentication_not_checked');
  assert.equal(noPass[0].verified, false);
  const inspected = await inspectLocalBackupCatalog({ directory, password: pass });
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].authenticated, true);
  assert.equal(inspected[0].verified, false);
  assert.equal(inspected[0].restoreTested, false);
  const retention = catalogRetentionSuggestions(inspected);
  assert.deepEqual(retention.proposedRemovals, []);
  assert.deepEqual(retention.manualReview, [name]);
  assert.ok((await readdir(directory)).includes(name + '.receipt.json'));
});
test('tampered payload, bad password and unknown files stay unverified without deletes', async t => {
  const directory = await fixture(t);
  await fakeEncryptedPg(directory, 'catalog-valid.domyrobackup');
  await fakeEncryptedPg(directory, 'catalog-tamper.domyrobackup');
  await fakeEncryptedPg(directory, 'catalog-unknown.domyrobackup');
  for (const name of ['catalog-valid.domyrobackup', 'catalog-tamper.domyrobackup']) {
    await registerVerifiedPostgresBackup({ directory, name, password: pass });
  }
  const file = await open(join(directory, 'catalog-tamper.domyrobackup'), 'r+');
  try {
    const st = await file.stat(), byte = Buffer.alloc(1);
    await file.read(byte, 0, 1, st.size - 20);
    byte[0] ^= 1;
    await file.write(byte, 0, 1, st.size - 20);
  } finally { await file.close(); }
  const wrong = await inspectLocalBackupCatalog({ directory, password: 'incorrect-but-long-test-password' });
  assert.ok(wrong.every(x => x.verified === false));
  const checked = await inspectLocalBackupCatalog({ directory, password: pass });
  assert.equal(checked.find(x => x.filename === 'catalog-valid.domyrobackup').authenticated, true);
  assert.equal(checked.find(x => x.filename === 'catalog-tamper.domyrobackup').authenticated, false);
  assert.equal(checked.find(x => x.filename === 'catalog-unknown.domyrobackup').authenticated, false);
  assert.deepEqual(catalogRetentionSuggestions(checked).proposedRemovals, []);
});
test('symlinked files and unsafe directories cannot impersonate an owned recovery point', async t => {
  const directory = await fixture(t);
  const backup = 'safe-snapshot.domyrobackup';
  await fakeEncryptedPg(directory, backup);
  await symlink(join(directory, backup), join(directory, 'symlinked.domyrobackup'));
  const records = await inspectLocalBackupCatalog({ directory, password: pass });
  assert.equal(records.find(x => x.filename === 'symlinked.domyrobackup').verified, false);
  await assert.rejects(() => registerVerifiedPostgresBackup({
    directory, name: 'symlinked.domyrobackup', password: pass,
  }));
  await assert.rejects(() => registerVerifiedPostgresBackup({
    directory, name: '../escaped.domyrobackup', password: pass,
  }), /unsafe_backup_filename/);
  await chmod(directory, 0o755);
  await assert.rejects(() => inspectLocalBackupCatalog({ directory, password: pass }), /backup_directory_must_be_private/);
});
test('plain PGDMP prefix is not classified as a valid encrypted backup', async t => {
  const directory = await fixture(t);
  const file = await open(join(directory, 'plain-snapshot.domyrobackup'), 'wx', 0o600);
  try { await file.writeFile(Buffer.concat([Buffer.from('PGDMP'), randomBytes(1024)])); }
  finally { await file.close(); }
  const result = await inspectLocalBackupCatalog({ directory, password: pass });
  assert.equal(result[0].owned, false);
  assert.deepEqual(catalogRetentionSuggestions(result).proposedRemovals, []);
});
