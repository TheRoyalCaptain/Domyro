// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Atomically PERSIST a bounded encrypted backup in a private local directory.
 * A hard link ("no replace") publishes the fully fsynced temporary file.
 *
 * Not a scheduled/NAS/USB/SMB backup service. No automatic cleanup/deletion,
 * no permissions expansion, and no interaction with a live home installation.
 */
import { randomBytes } from 'node:crypto';
import { constants as fileFlags } from 'node:fs';
import { open, lstat, link, unlink, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
const MAX_ENCRYPTED_FILE = 34 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9_-]{1,90}\.domyrobackup$/;

function validateName(name) {
  if (typeof name !== 'string' || !NAME.test(name) || basename(name) !== name) {
    throw new TypeError('unsafe_backup_filename');
  }
  return name;
}
async function validateDirectory(directory) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('backup_directory_required');
  const path = resolve(directory);
  const st = await lstat(path);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 ||
      await realpath(path) !== path) throw new Error('backup_directory_must_be_private');
  return path;
}
function validBytes(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 28 && buffer.length <= MAX_ENCRYPTED_FILE &&
    buffer.subarray(0,8).toString('ascii') === 'DOMYROB1';
}

/**
 * Never replaces an existing target file. Exclusive hardlink publication
 * prevents the accidental overwrite that a plain rename() could perform.
 */
export async function storeEncryptedBackupFile({ directory, name, encrypted }) {
  const targetName = validateName(name);
  if (!validBytes(encrypted)) throw new TypeError('encrypted_backup_bytes_invalid');
  const dir = await validateDirectory(directory);
  const temp = join(dir,'.domyro-staging-' + randomBytes(12).toString('hex'));
  const destination = join(dir,targetName);
  let fd;
  try {
    fd = await open(temp,'wx',0o600);
    await fd.writeFile(encrypted);
    await fd.sync();
    await fd.close();
    fd = null;
    await link(temp,destination);
    const directoryHandle = await open(dir,'r');
    try { await directoryHandle.sync(); }
    finally { await directoryHandle.close(); }
    return Object.freeze({ filename: targetName, bytes: encrypted.length, created: true });
  } finally {
    if (fd) await fd.close();
    try { await unlink(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
/** Reading does not decrypt or trust a backup; call verifyEncryptedPostgresSnapshot. */
export async function readEncryptedBackupFile({ directory, name }) {
  const dir = await validateDirectory(directory);
  const path = join(dir,validateName(name));
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 ||
      st.size < 29 || st.size > MAX_ENCRYPTED_FILE) throw new Error('backup_file_untrusted');
  // O_NOFOLLOW closes the symlink-swap gap between lstat() and open().
  const fd = await open(path,fileFlags.O_RDONLY | fileFlags.O_NOFOLLOW);
  try {
    const after = await fd.stat();
    if (!after.isFile() || after.ino !== st.ino || after.dev !== st.dev ||
        after.size !== st.size || (after.mode & 0o077) !== 0) throw new Error('backup_file_changed');
    const bytes = await fd.readFile();
    if (!validBytes(bytes)) throw new Error('backup_file_invalid');
    return bytes;
  } finally { await fd.close(); }
}
