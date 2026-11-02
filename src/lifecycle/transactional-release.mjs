// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolated release staging and switch prototype. NOT a native installer or updater.
 * No systemd, DB migration, process control, host package changes, network or OS writes.
 * No database recovery exists here, so never use this for a live upgrade.
 */
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, lstat, open, rm, symlink, readlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { verifyArtifactBytes, verifySignedManifest } from './release.mjs';

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1500;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 96 * 1024 * 1024;
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
  if (!details.isDirectory() || details.isSymbolicLink() || (details.mode & 0o022) !== 0) throw new Error('staged_release_not_private_directory');
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
/**
 * Re-authenticate every staged file before a test service starts or an
 * isolated pointer switch. Rejects extra files and symlinked directories.
 * No production install or update authorization is ever returned.
 */
export async function inspectVerifiedStagedBundle({root,version,trustedPublicKeyPem,expectedArch=null}) {
  checkedVersion(version);
  if(typeof trustedPublicKeyPem!=='string'||!trustedPublicKeyPem)throw new Error('pinned_trust_root_required');
  const base=await safeRoot(root);
  if(await readFile(join(base,MARKER),'utf8')!=='Domyro isolated release prototype v1\n')throw new Error('invalid_release_root_marker');
  const releaseRoot=join(base,'releases'),release=join(releaseRoot,version);
  await checkReleaseDirectory(releaseRoot);
  await checkReleaseDirectory(release);
  let receipt;
  const receiptPath=join(release,'.receipt.json');
  try {
    const receiptStat=await lstat(receiptPath);
    if(!receiptStat.isFile()||receiptStat.isSymbolicLink()||receiptStat.nlink!==1||
       receiptStat.size>MAX_RECEIPT_BYTES||(receiptStat.mode&0o022)!==0)
      throw new Error('staged_release_receipt_unsafe');
    receipt=JSON.parse(await readFile(receiptPath,'utf8'));
  } catch(error) {
    if(error.message==='staged_release_receipt_unsafe')throw error;
    throw new Error('staged_release_receipt_missing');
  }
  const manifestBytes=Buffer.from(receipt.manifest??'','base64');
  const manifest=verifySignedManifest({manifestBytes,signatureBase64:receipt.signature,trustedPublicKeyPem});
  if(manifest.version!==version)throw new Error('staged_release_version_changed');
  if(expectedArch!==null && receipt.architecture!==expectedArch)throw new Error('staged_release_architecture_mismatch');
  const bytes=Buffer.from(receipt.artifact??'','base64');
  const artifact=manifest.artifacts.find(x=>x.os==='ubuntu'&&x.arch===receipt.architecture);
  if(!artifact||!verifyArtifactBytes(artifact,bytes))throw new Error('staged_release_artifact_changed');
  const entries=bundleFiles(bytes);
  const expected=new Set(entries.map(x=>x.path));
  const expectedDirectories=new Set();
  for(const path of expected){
    let parent=path;
    while(parent.includes('/')){
      parent=parent.slice(0,parent.lastIndexOf('/'));
      expectedDirectories.add(parent);
    }
  }
  for(const entry of entries){
    const filePath=join(release,...entry.path.split('/'));
    const stat=await lstat(filePath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
       (stat.mode&0o022)!==0||stat.size!==entry.bytes.length)throw new Error('staged_release_file_changed');
    if(!(await readFile(filePath)).equals(entry.bytes))throw new Error('staged_release_file_changed');
  }
  let found=0;
  async function walk(folder,prefix=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(!prefix&&entry.name==='.receipt.json')continue;
      const relative=prefix+entry.name;
      if(entry.isSymbolicLink())throw new Error('staged_release_symlink_forbidden');
      if(entry.isDirectory()){
        if(!expectedDirectories.has(relative))throw new Error('staged_release_unlisted_directory');
        const stat=await lstat(join(folder,entry.name));
        if((stat.mode&0o022)!==0)throw new Error('staged_release_directory_writable');
        await walk(join(folder,entry.name),relative+'/');
      } else if(entry.isFile()){
        if(!expected.has(relative))throw new Error('staged_release_unlisted_file');
        found++;
      }else throw new Error('staged_release_unknown_entry');
    }
  }
  await walk(release);
  if(found!==expected.size)throw new Error('staged_release_file_count_mismatch');
  return Object.freeze({version,architecture:receipt.architecture,files:found,verified:true,installationApproved:false});
}

export async function switchActiveBundle({ root, version, confirmedVersion, verifiedBackup, trustedPublicKeyPem, probe }) {
  checkedVersion(version);
  if (confirmedVersion !== version) throw new Error('explicit_version_confirmation_required');
  if (verifiedBackup !== true) throw new Error('verified_backup_required');
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem) throw new Error('pinned_trust_root_required');
  if (typeof probe !== 'function') throw new Error('post_activation_probe_required');
  const base=await safeRoot(root);
  await inspectVerifiedStagedBundle({root:base,version,trustedPublicKeyPem});
  const release=join(base,'releases',version);
  const lock = await open(join(base, '.activation.lock'), 'wx', 0o600);
  let previous = null, switched = false, completed = false;
  try {
    previous = await currentVersion(base);
    if (previous === version) throw new Error('already_active');
    // A pointer rollback is not safe if the previous signed release has
    // disappeared or changed. Reject before touching the active pointer.
    if(previous!==null)await inspectVerifiedStagedBundle({
      root:base,version:previous,trustedPublicKeyPem,
    });
    if(await currentVersion(base)!==previous)throw new Error('active_release_changed_during_preflight');
    await changePointer(base, version);
    switched = true;
    let healthy = false;
    try { healthy = await probe({ version, root: base, release }) === true; } catch { healthy = false; }
    if (!healthy) throw new Error('post_activation_health_failed_rolled_back_pointer');
    completed = true;
    return Object.freeze({ active: version, previous, healthy: true, serviceRestarted: false, databaseMigrated: false, installationApproved: false, gate: 'D-53' });
  } finally {
    // Never leave the activation lock behind just because pointer rollback or
    // previous-release re-verification failed. The caller must see a distinct
    // critical recovery error instead of a false successful rollback.
    let recoveryError = null;
    try {
      if (switched && !completed) {
        await changePointer(base, previous);
        if (previous !== null) await inspectVerifiedStagedBundle({
          root:base,version:previous,trustedPublicKeyPem,
        });
      }
    } catch(error) { recoveryError = error; }
    try { await lock.close(); } catch(error) { recoveryError ??= error; }
    try { await rm(join(base, '.activation.lock'), { force: true }); }
    catch(error) { recoveryError ??= error; }
    if(recoveryError)throw new Error('rollback_integrity_or_cleanup_failed', {cause:recoveryError});
  }
}
export async function inspectActiveBundle(root) {
  return currentVersion(await safeRoot(root));
}
