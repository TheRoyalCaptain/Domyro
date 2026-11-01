// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Small, explicit development-only configuration backup fixture.
 *
 * Cannot read arbitrary directories, symlinks, or any live service data:
 * only selected regular 0600 files directly inside a private test root.
 * Every payload is encrypted with the DOMYROS2 stream envelope.
 * This DOES NOT restore config files, own Matter keys or access Zigbee radios.
 */
import { createHash } from 'node:crypto';
import { constants as flags } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { encryptStreamToPrivateFile, withVerifiedPrivateBackup } from './streamed-backup.mjs';

const ROLES = new Set(['domyro_core', 'mosquitto', 'zigbee2mqtt']);
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const MAX_FILES = 12;
const MAX_EACH = 512 * 1024;
const MAX_PAYLOAD = 8 * 1024 * 1024;
const PREFIX = Buffer.from('DOMCONF1\n', 'ascii');

async function privateRoot(root) {
  if (typeof root !== 'string' || !root) throw new TypeError('config_root_required');
  const dir = resolve(root), stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
    await realpath(dir) !== dir) throw new Error('config_root_must_be_private');
  return dir;
}
function fileName(name) {
  if (typeof name !== 'string' || !SAFE_FILE.test(name) || basename(name) !== name ||
      name === '.' || name === '..') throw new TypeError('config_filename_invalid');
  return name;
}
async function privateFile(dir, name) {
  const path = join(dir, fileName(name)), before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077) ||
      before.size < 1 || before.size > MAX_EACH) throw new Error('config_file_untrusted');
  const fd = await open(path, flags.O_RDONLY | flags.O_NOFOLLOW);
  try {
    const after = await fd.stat();
    if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev ||
      after.size !== before.size || (after.mode & 0o077)) throw new Error('config_file_changed');
    const bytes = await fd.readFile();
    if (bytes.length !== after.size) throw new Error('config_file_changed');
    return bytes;
  } finally { await fd.close(); }
}
function validateFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new TypeError('config_files_invalid');
  const ids = new Set();
  return files.map(row => {
    if (!row || typeof row.role !== 'string' || !ROLES.has(row.role)) throw new TypeError('config_role_not_supported');
    const name = fileName(row.name);
    const key = row.role + '/' + name;
    if (ids.has(key)) throw new TypeError('config_duplicate_file');
    ids.add(key);
    return { role: row.role, name };
  });
}
/** Captures a small explicitly selected set of OWNED test fixtures. */
export async function createEncryptedConfigFixture({ root, files, directory, name, password }) {
  const selected = validateFiles(files);
  const dir = await privateRoot(root);
  const rows = [];
  for (const item of selected) {
    const bytes = await privateFile(dir, item.name);
    rows.push({
      role: item.role, name: item.name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length, base64: bytes.toString('base64'),
    });
  }
  const plaintext = Buffer.concat([PREFIX, Buffer.from(JSON.stringify({
    schemaVersion: 1, format: 'domyro-selected-config-fixture',
    files: rows,
  }))]);
  if (plaintext.length > MAX_PAYLOAD) throw new Error('config_bundle_too_large');
  const saved = await encryptStreamToPrivateFile({
    source: Readable.from([plaintext]), directory, name, password, maxPlainBytes: MAX_PAYLOAD,
  });
  return Object.freeze({ ...saved, kinds: Object.freeze([...new Set(selected.map(x => x.role))]),
    restoreReady: false });
}

/**
 * Check a small configuration backup without exposing any file contents or
 * writing any restored configuration. This is not a full-system restore test.
 */
export async function inspectEncryptedConfigFixture({ directory, name, password }) {
  return withVerifiedPrivateBackup({
    directory, name, password, maxPlainBytes: MAX_PAYLOAD,
    callback: async ({ archivePath, plaintextBytes }) => {
      const fd = await open(archivePath, flags.O_RDONLY | flags.O_NOFOLLOW);
      let bytes;
      try {
        const st = await fd.stat();
        if (!st.isFile() || st.size !== plaintextBytes || st.size > MAX_PAYLOAD) throw new Error('config_bundle_invalid');
        bytes = await fd.readFile();
      } finally { await fd.close(); }
      if (!bytes.subarray(0, PREFIX.length).equals(PREFIX)) throw new Error('config_bundle_invalid');
      let payload;
      try { payload = JSON.parse(bytes.subarray(PREFIX.length).toString('utf8')); }
      catch { throw new Error('config_bundle_invalid'); }
      if (payload?.schemaVersion !== 1 || payload.format !== 'domyro-selected-config-fixture') throw new Error('config_bundle_invalid');
      const selected = validateFiles(payload.files);
      const entries = [];
      for (let i = 0; i < selected.length; i++) {
        const original = payload.files[i];
        if (typeof original.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(original.base64)) {
          throw new Error('config_bundle_invalid');
        }
        const data = Buffer.from(original.base64, 'base64');
        if (data.length > MAX_EACH || data.length < 1 ||
            data.toString('base64') !== original.base64 ||
            data.length !== original.bytes ||
            !/^[a-f0-9]{64}$/.test(original.sha256 ?? '') ||
            createHash('sha256').update(data).digest('hex') !== original.sha256) throw new Error('config_bundle_integrity_failed');
        entries.push(Object.freeze({ role: selected[i].role, name: selected[i].name,
          size: data.length, sha256: original.sha256 }));
      }
      return Object.freeze({ validEncryptedFixture: true, restoreTested: false,
        files: Object.freeze(entries) });
    },
  });
}
