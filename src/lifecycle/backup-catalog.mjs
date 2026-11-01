// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local-only backup catalogue for the disposable development environment.
 * A receipt is NEVER enough to claim a restorable snapshot. Only a successful
 * fresh AES-GCM verification and PostgreSQL header/size/hash check may mark it
 * cryptographically authenticated during an inspection. Authentication is
 * NOT proof of successful pg_restore, so retention never authorizes removal.
 * No deletes and no automatic restore.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants as flags } from 'node:fs';
import { open, lstat, realpath, readdir, link, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { withVerifiedPrivateBackup } from './streamed-backup.mjs';
import { planBackupRetention } from './backup-retention.mjs';
import { inspectEncryptedConfigFixture } from './config-fixture-backup.mjs';

const NAME = /^[a-z0-9][a-z0-9_-]{1,90}\.domyrobackup$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_RECEIPT = 4096;
const CHUNK = 64 * 1024;

function checkedName(name) {
  if (typeof name !== 'string' || basename(name) !== name || !NAME.test(name)) throw new TypeError('unsafe_backup_filename');
  return name;
}
async function privateDirectory(directory) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('backup_directory_required');
  const dir = resolve(directory), st = await lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || await realpath(dir) !== dir) {
    throw new Error('backup_directory_must_be_private');
  }
  return dir;
}
async function noFollowRegular(path, maxSize = 2 * 1024 * 1024 * 1024 + 4096) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077) || before.size < 1 || before.size > maxSize) {
    throw new Error('catalog_file_untrusted');
  }
  const fd = await open(path, flags.O_RDONLY | flags.O_NOFOLLOW);
  try {
    const after = await fd.stat();
    if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev ||
        after.size !== before.size || (after.mode & 0o077)) throw new Error('catalog_file_changed');
    return { fd, length: after.size };
  } catch (e) { await fd.close(); throw e; }
}
async function hashEncryptedFile(path) {
  const { fd, length } = await noFollowRegular(path);
  try {
    const header = Buffer.alloc(8);
    const head = await fd.read(header, 0, 8, 0);
    if (head.bytesRead !== 8 || header.toString('ascii') !== 'DOMYROS2') throw new Error('catalog_encryption_format_invalid');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(CHUNK);
    for (let pos = 0; pos < length;) {
      const { bytesRead } = await fd.read(buffer, 0, Math.min(CHUNK, length - pos), pos);
      if (!bytesRead) throw new Error('catalog_file_changed');
      digest.update(buffer.subarray(0, bytesRead));
      pos += bytesRead;
    }
    return { checksum: digest.digest('hex'), encryptedBytes: length };
  } finally { await fd.close(); }
}
function validReceipt(receipt, expectedName) {
  if (!receipt || receipt.schemaVersion !== 1 || !['postgresql-custom', 'domyro-selected-config-fixture'].includes(receipt.kind) ||
      receipt.name !== expectedName || receipt.targetId !== 'local' ||
      !SHA.test(receipt.encryptedSha256 ?? '') || !SHA.test(receipt.plaintextSha256 ?? '') ||
      !Number.isSafeInteger(receipt.encryptedBytes) || receipt.encryptedBytes < 32 ||
      !Number.isSafeInteger(receipt.plaintextBytes) || receipt.plaintextBytes < 8 ||
      typeof receipt.completedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(receipt.completedAt) ||
      !Number.isFinite(Date.parse(receipt.completedAt))) throw new Error('catalog_receipt_invalid');
  return receipt;
}
async function readReceipt(dir, name) {
  const { fd, length } = await noFollowRegular(join(dir, name + '.receipt.json'), MAX_RECEIPT);
  try {
    const data = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await fd.read(data, offset, length - offset, offset);
      if (!bytesRead) throw new Error('catalog_receipt_truncated');
      offset += bytesRead;
    }
    let object;
    try { object = JSON.parse(data.toString('utf8')); }
    catch { throw new Error('catalog_receipt_invalid'); }
    return validReceipt(object, name);
  } finally { await fd.close(); }
}
async function verifyPgArchive({ directory, name, password, expectedSha256, expectedBytes }) {
  return withVerifiedPrivateBackup({
    directory, name, password,
    callback: async ({ archivePath, sha256, plaintextBytes }) => {
      const { fd, length } = await noFollowRegular(archivePath);
      try {
        const magic = Buffer.alloc(5);
        const { bytesRead } = await fd.read(magic, 0, 5, 0);
        if (bytesRead !== 5 || magic.toString('ascii') !== 'PGDMP') throw new Error('catalog_archive_not_postgresql');
      } finally { await fd.close(); }
      if (expectedSha256 && expectedSha256 !== sha256 ||
          expectedBytes !== undefined && expectedBytes !== plaintextBytes ||
          plaintextBytes !== length) throw new Error('catalog_archive_digest_changed');
      return { plaintextSha256: sha256, plaintextBytes };
    },
  });
}
async function verifyConfigArchive({directory,name,password,expectedSha256,expectedBytes}) {
  // This validates every included file's own SHA-256 and the AES-GCM envelope.
  const detail = await inspectEncryptedConfigFixture({directory,name,password});
  const archive = await withVerifiedPrivateBackup({
    directory,name,password,maxPlainBytes:8*1024*1024,
    callback:async ({sha256,plaintextBytes})=>{
      if(expectedSha256 && expectedSha256!==sha256 ||
         expectedBytes!==undefined && expectedBytes!==plaintextBytes)
        throw new Error('catalog_archive_digest_changed');
      return {plaintextSha256:sha256,plaintextBytes};
    },
  });
  return {...archive,components:[...new Set(detail.files.map(x=>x.role))]};
}
async function publishReceipt(dir, name, receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt) + '\n');
  if (bytes.length > MAX_RECEIPT) throw new Error('catalog_receipt_too_large');
  const stage = join(dir, '.domyro-catalog-stage-' + randomBytes(12).toString('hex'));
  let handle;
  try {
    handle = await open(stage, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(stage, join(dir, name + '.receipt.json'));
    const dirHandle = await open(dir, 'r');
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } finally {
    if (handle) await handle.close();
    try { await unlink(stage); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
/**
 * Register an already completed encrypted PostgreSQL backup. Requires a live
 * verification pass and a signed-in development operator-supplied passphrase.
 * It never creates snapshots or modifies the database.
 */
export async function registerVerifiedPostgresBackup({ directory, name, password, completedAt = new Date().toISOString() }) {
  checkedName(name);
  if (!Number.isFinite(Date.parse(completedAt)) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(completedAt)) {
    throw new TypeError('invalid_backup_timestamp');
  }
  const dir = await privateDirectory(directory);
  const archive = await verifyPgArchive({ directory: dir, name, password });
  const encrypted = await hashEncryptedFile(join(dir, name));
  const receipt = Object.freeze({
    schemaVersion: 1, kind: 'postgresql-custom', name,
    targetId: 'local', completedAt,
    encryptedSha256: encrypted.checksum, encryptedBytes: encrypted.encryptedBytes,
    plaintextSha256: archive.plaintextSha256, plaintextBytes: archive.plaintextBytes,
  });
  await publishReceipt(dir, name, receipt);
  return receipt;
}
/** Register selected configuration fixtures, without claiming a working restore. */
export async function registerVerifiedConfigFixture({directory,name,password,completedAt=new Date().toISOString()}) {
  checkedName(name);
  if(!Number.isFinite(Date.parse(completedAt)) ||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(completedAt)) throw new TypeError('invalid_backup_timestamp');
  const dir=await privateDirectory(directory);
  const archive=await verifyConfigArchive({directory:dir,name,password});
  const encrypted=await hashEncryptedFile(join(dir,name));
  const receipt=Object.freeze({
    schemaVersion:1,kind:'domyro-selected-config-fixture',name,targetId:'local',completedAt,
    encryptedSha256:encrypted.checksum,encryptedBytes:encrypted.encryptedBytes,
    plaintextSha256:archive.plaintextSha256,plaintextBytes:archive.plaintextBytes,
  });
  await publishReceipt(dir,name,receipt);
  return receipt;
}
/**
 * Enumerate backups, including unknown and corrupted ones. Never trust receipt
 * metadata as an authentication guarantee. Without a password, all are
 * unverified. With a password, each backup is reauthenticated from disk.
 */
export async function inspectLocalBackupCatalog({ directory, password = null }) {
  const dir = await privateDirectory(directory);
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter(item => NAME.test(item.name)).map(item => item.name).sort();
  if (names.length > 10000) throw new Error('catalog_entry_limit');
  const records = [];
  for (const name of names) {
    const row = { id: name, filename: name, targetId: 'local',
      owned: false, completed: false, verified: false, authenticated: false,
      restoreTested: false, hold: false, reason: 'unknown_or_unverified' };
    try {
      const receipt = await readReceipt(dir, name);
      const digest = await hashEncryptedFile(join(dir, name));
      if (digest.checksum !== receipt.encryptedSha256 || digest.encryptedBytes !== receipt.encryptedBytes) {
        row.reason = 'encrypted_file_changed';
      } else if (password === null) {
        row.reason = 'authentication_not_checked';
      } else {
        const inspected=receipt.kind==='postgresql-custom'
          ? await verifyPgArchive({directory:dir,name,password,
              expectedSha256:receipt.plaintextSha256,expectedBytes:receipt.plaintextBytes})
          : await verifyConfigArchive({directory:dir,name,password,
              expectedSha256:receipt.plaintextSha256,expectedBytes:receipt.plaintextBytes});
        Object.assign(row, { kind:receipt.kind,components:inspected.components??[],
          owned: true, completed: true, authenticated: true,
          // Not a verified recovery point until a separate actual restore test
          // succeeds. Do not let a valid-but-unrestorable PGDMP prefix prune.
          verified: false, restoreTested: false,
          completedAt: receipt.completedAt, plaintextBytes: receipt.plaintextBytes,
          reason: 'authenticated_not_restore_tested' });
      }
    } catch {
      row.reason = 'invalid_or_missing_receipt_or_backup';
    }
    records.push(Object.freeze(row));
  }
  return Object.freeze(records);
}

/** Non-destructive per-local-target retention suggestions. Never unlink. */
export function catalogRetentionSuggestions(records, policy) {
  if (!Array.isArray(records)) throw new TypeError('invalid_catalog_records');
  // Unknown/failed records remain visible for manual review, with an old
  // completedAt only for the pure retention planner. No actual files are removed.
  const prepared = records.map(r => ({
    id: r.id, targetId: r.targetId,
    completedAt: r.completedAt ?? '1970-01-01T00:00:00.000Z',
    // Independent restore-proof registration does not exist yet, so this
    // development catalog can NEVER make a backup a pruning candidate.
    owned: r.owned === true, verified: false,
    completed: r.completed === true, hold: r.hold === true,
  }));
  return planBackupRetention(prepared, policy);
}
