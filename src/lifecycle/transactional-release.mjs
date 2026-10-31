// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolated release staging and switch prototype. NOT a native installer or updater.
 * No systemd, DB migration, process control, host package changes, network or OS writes.
 * No database recovery exists here, so never use this for a live upgrade.
 */
import { mkdir, mkdtemp, readFile, realpath, rename, lstat, open, rm, symlink, readlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { verifyArtifactBytes, verifySignedManifest } from './release.mjs';

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1500;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FILE_NAME = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const VERSION_DIR = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const MARKER = '.domyro-release-root';

async function safeRoot(root) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('root_required');
  const absolute = resolve(root);
  if (absolute === '/' || absolute === tmpdir() || absolute === process.cwd()) throw new Error('unsafe_root');
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('root_not_private_directory');
  if (await realpath(absolute) !== absolute) throw new Error('root_contains_symlink');
  if ((details.mode & 0o022) !== 0) throw new Error('root_group_or_world_writable');
  return absolute;
}
async function ensureMarker(root) {
  const marker = join(root, MARKER);
  try {
    if (await readFile(marker, 'utf8') !== 'Domyro isolated release prototype v1\n') throw new Error('invalid_release_root_marker');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const handle = await open(marker, 'wx', 0o600);
    try { await handle.writeFile('Domyro isolated release prototype v1\n'); }
    finally { await handle.close(); }
  }
}
function bundleFiles(input) {
  if (!Buffer.isBuffer(input) || input.length < 1 || input.length > MAX_BUNDLE_BYTES) throw new Error('bundle_size_invalid');
  const doc = JSON.parse(input.toString('utf8'));
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.files) || !doc.files.length || doc.files.length > MAX_FILES) throw new Error('bundle_schema_invalid');
  const used = new Set(), result = [];
  let expanded = 0;
  for (const file of doc.files) {
    if (!file || typeof file.path !== 'string' || !FILE_NAME.test(file.path) || file.path.startsWith('.') || file.path.split('/').some(n => n === '.' || n === '..') || used.has(file.path)) throw new Error('bundle_path_invalid');
    used.add(file.path);
    if (typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error('bundle_base64_invalid');
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64 || bytes.length > MAX_FILE_BYTES) throw new Error('bundle_file_size_invalid');
    expanded += bytes.length;
    if (expanded > MAX_BUNDLE_BYTES) throw new Error('bundle_expansion_invalid');
    result.push({ path: file.path, bytes });
  }
  for (const path of used) {
    let parent = path;
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      if (used.has(parent)) throw new Error('bundle_path_conflict');
    }
  }
  return result;
}
async function checkReleaseDirectory(path) {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('staged_release_not_directory');
}
export async function stageVerifiedBundle({ root, manifestBytes, signatureBase64, trustedPublicKeyPem, artifactBytes, arch }) {
  const manifest = verifySignedManifest({ manifestBytes, signatureBase64, trustedPublicKeyPem });
  if (!VERSION_DIR.test(manifest.version) || !['amd64', 'arm64'].includes(arch)) throw new Error('unsupported_stage_target');
  const artifact = manifest.artifacts.find(x => x.os === 'ubuntu' && x.arch === arch);
  if (!artifact) throw new Error('target_artifact_missing');
  if (!verifyArtifactBytes(artifact, artifactBytes)) throw new Error('artifact_hash_mismatch');
  const files = bundleFiles(artifactBytes);
  const base = await safeRoot(root);
  await ensureMarker(base);
  const releases = join(base, 'releases');
  await mkdir(releases, { mode: 0o700, recursive: true });
  await checkReleaseDirectory(releases);
  const output = join(releases, manifest.version);
  try { await lstat(output); throw new Error('release_already_staged'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const staging = await mkdtemp(join(releases, '.staging-'));
  try {
    for (const file of files) {
      const target = join(staging, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const handle = await open(target, 'wx', 0o600);
      try { await handle.writeFile(file.bytes); } finally { await handle.close(); }
    }
    const receipt = JSON.stringify({
      manifest: Buffer.from(manifestBytes).toString('base64'),
      signature: signatureBase64,
      artifact: artifactBytes.toString('base64'),
      architecture: arch,
    });
    const h = await open(join(staging, '.receipt.json'), 'wx', 0o600);
    try { await h.writeFile(receipt); } finally { await h.close(); }
    await rename(staging, output);
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
  return Object.freeze({ version: manifest.version, files: files.length, activated: false, changesToServices: false });
}
function checkedVersion(version) {
  if (typeof version !== 'string' || !VERSION_DIR.test(version) || version.includes('..')) throw new Error('unsafe_version');
  return version;
}
async function currentVersion(root) {
  try {
    const info = await lstat(join(root, 'current'));
    if (!info.isSymbolicLink()) throw new Error('active_release_not_symlink');
    const target = await readlink(join(root, 'current'));
    if (!/^releases\/[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(target)) throw new Error('active_release_outside_store');
    return target.slice('releases/'.length);
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function changePointer(root, version) {
  const temp = join(root, '.current-' + randomUUID());
  try {
    if (version != null) {
      await symlink('releases/' + checkedVersion(version), temp);
      await rename(temp, join(root, 'current'));
    } else await rm(join(root, 'current'), { force: true });
  } finally { await rm(temp, { force: true }); }
}
/**
 * In-memory health callback, manual confirmation and a caller-supplied backup
 * flag are NOT yet sufficient to update a real production server.
 */
export async function switchActiveBundle({ root, version, confirmedVersion, verifiedBackup, trustedPublicKeyPem, probe }) {
  checkedVersion(version);
  if (confirmedVersion !== version) throw new Error('explicit_version_confirmation_required');
  if (verifiedBackup !== true) throw new Error('verified_backup_required');
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem) throw new Error('pinned_trust_root_required');
  if (typeof probe !== 'function') throw new Error('post_activation_probe_required');
  const base = await safeRoot(root);
  if (await readFile(join(base, MARKER), 'utf8') !== 'Domyro isolated release prototype v1\n') throw new Error('invalid_release_root_marker');
  const release = join(base, 'releases', version);
  await checkReleaseDirectory(release);
  let receipt;
  try { receipt = JSON.parse(await readFile(join(release, '.receipt.json'), 'utf8')); }
  catch { throw new Error('staged_release_receipt_missing'); }
  const manifestBytes = Buffer.from(receipt.manifest ?? '', 'base64');
  const manifest = verifySignedManifest({ manifestBytes, signatureBase64: receipt.signature, trustedPublicKeyPem });
  if (manifest.version !== version) throw new Error('staged_release_version_changed');
  const bytes = Buffer.from(receipt.artifact ?? '', 'base64');
  const artifact = manifest.artifacts.find(x => x.os === 'ubuntu' && x.arch === receipt.architecture);
  if (!artifact || !verifyArtifactBytes(artifact, bytes)) throw new Error('staged_release_artifact_changed');
  for (const entry of bundleFiles(bytes)) {
    const filePath = join(release, ...entry.path.split('/'));
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes.length) throw new Error('staged_release_file_changed');
    if (!(await readFile(filePath)).equals(entry.bytes)) throw new Error('staged_release_file_changed');
  }
  const lock = await open(join(base, '.activation.lock'), 'wx', 0o600);
  let previous = null, switched = false, completed = false;
  try {
    previous = await currentVersion(base);
    if (previous === version) throw new Error('already_active');
    await changePointer(base, version);
    switched = true;
    let healthy = false;
    try { healthy = await probe({ version, root: base, release }) === true; } catch { healthy = false; }
    if (!healthy) throw new Error('post_activation_health_failed_rolled_back_pointer');
    completed = true;
    return Object.freeze({ active: version, previous, healthy: true, serviceRestarted: false, databaseMigrated: false });
  } finally {
    if (switched && !completed) await changePointer(base, previous);
    await lock.close();
    await rm(join(base, '.activation.lock'), { force: true });
  }
}
export async function inspectActiveBundle(root) {
  return currentVersion(await safeRoot(root));
}
