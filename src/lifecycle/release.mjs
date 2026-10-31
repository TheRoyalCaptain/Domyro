// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure update verification and preflight. NO downloading, package installation,
 * filesystem changes, database migrations, or service restarts occur here.
 * The public key must come from a separately authenticated/pinned trust root.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

const HEX_256 = /^[a-f0-9]{64}$/;
const SAFE_ARTIFACT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SAFE_VERSION_COMPONENT = 1_000_000;
const MIN_FREE_OVERHEAD_BYTES = 32 * 1024 * 1024;

function assertObject(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(where + ' must be an object');
  }
}

function parseVersion(value) {
  if (typeof value !== 'string') throw new TypeError('version must be a string');
  const match = VERSION.exec(value);
  if (!match) throw new TypeError('version must be strict SemVer without build metadata');
  const numbers = match.slice(1, 4).map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n) || n > MAX_SAFE_VERSION_COMPONENT)) {
    throw new TypeError('version component too large');
  }
  const pre = match[4] ? match[4].split('.') : [];
  for (const part of pre) {
    if (/^\d+$/.test(part) && (part.length > 1 && part.startsWith('0') || !Number.isSafeInteger(Number(part)))) {
      throw new TypeError('invalid prerelease numeric component');
    }
  }
  return { numbers, pre };
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x.numbers[i] !== y.numbers[i]) return Math.sign(x.numbers[i] - y.numbers[i]);
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === q) continue;
    const pNum = /^\d+$/.test(p), qNum = /^\d+$/.test(q);
    if (pNum && qNum) return Math.sign(BigInt(p) > BigInt(q) ? 1 : -1);
    if (pNum !== qNum) return pNum ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/**
 * Verify the precise original signed bytes, not a JSON reserialization.
 * @param {{manifestBytes:Buffer|string, signatureBase64:string, trustedPublicKeyPem:string}} args
 */
export function verifySignedManifest({ manifestBytes, signatureBase64, trustedPublicKeyPem }) {
  if (!(Buffer.isBuffer(manifestBytes) || typeof manifestBytes === 'string')) {
    throw new TypeError('manifestBytes must be a Buffer or string');
  }
  const bytes = Buffer.isBuffer(manifestBytes) ? manifestBytes : Buffer.from(manifestBytes, 'utf8');
  if (!bytes.length || bytes.length > MAX_MANIFEST_BYTES) throw new Error('manifest_size_invalid');
  if (typeof signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)) {
    throw new Error('signature_invalid');
  }
  const signature = Buffer.from(signatureBase64, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== signatureBase64) {
    throw new Error('signature_invalid');
  }
  const key = createPublicKey(trustedPublicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, bytes, key, signature)) {
    throw new Error('signature_untrusted');
  }

  const manifest = JSON.parse(bytes.toString('utf8'));
  assertObject(manifest, 'manifest');
  if (manifest.schemaVersion !== 1) throw new Error('manifest_schema_unsupported');
  parseVersion(manifest.version);
  if (!['stable', 'beta'].includes(manifest.channel)) throw new Error('release_channel_invalid');
  if (manifest.channel === 'stable' && parseVersion(manifest.version).pre.length > 0) {
    throw new Error('stable_prerelease_not_allowed');
  }
  if (typeof manifest.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(manifest.publishedAt) || !Number.isFinite(Date.parse(manifest.publishedAt))) {
    throw new Error('published_at_invalid');
  }
  assertObject(manifest.database, 'database');
  const { min, max, target, migration } = manifest.database;
  if (![min, max, target].every(x => Number.isSafeInteger(x) && x >= 0) || min > max || target < min || target > max || !['none', 'reversible', 'irreversible'].includes(migration)) {
    throw new Error('database_compatibility_invalid');
  }
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length || manifest.artifacts.length > 16) {
    throw new Error('artifact_catalog_invalid');
  }
  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    assertObject(artifact, 'artifact');
    if (artifact.os !== 'ubuntu' || !['amd64', 'arm64'].includes(artifact.arch) || !SAFE_ARTIFACT.test(artifact.file) || !HEX_256.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) {
      throw new Error('artifact_invalid');
    }
    const id = artifact.os + '/' + artifact.arch;
    if (seen.has(id)) throw new Error('duplicate_artifact_target');
    seen.add(id);
  }
  // The result is trusted *only* because the caller supplied a pinned official key.
  // Freezing prevents accidental mutation after a successful signature check.
  return Object.freeze({ ...manifest, database: Object.freeze({ ...manifest.database }), artifacts: Object.freeze(manifest.artifacts.map(a => Object.freeze({ ...a }))) });
}

/** Verify artifact bytes against signed metadata; does not stage/install them. */
export function verifyArtifactBytes(artifact, bytes) {
  if (!artifact || !Buffer.isBuffer(bytes) || bytes.byteLength !== artifact.bytes || !HEX_256.test(artifact.sha256)) return false;
  const actual = createHash('sha256').update(bytes).digest('hex');
  return actual === artifact.sha256;
}

/**
 * Only constructs a preflight decision; it has no installer side effects.
 * Data from backup health and free space must come from real future services.
 */
export function assessManualUpgrade({
  manifestBytes, signatureBase64, trustedPublicKeyPem, currentVersion,
  os, arch, currentDatabaseSchema, availableBytes, backup,
  adminConfirmedVersion, now = new Date(),
}) {
  let manifest;
  try { manifest = verifySignedManifest({ manifestBytes, signatureBase64, trustedPublicKeyPem }); }
  catch { return { allowed: false, blockers: ['unverified_release'], targetVersion: null }; }
  const blockers = [];
  const artifact = manifest.artifacts.find(a => a.os === os && a.arch === arch);
  if (!artifact) blockers.push('unsupported_platform');
  try { if (compareVersions(manifest.version, currentVersion) <= 0) blockers.push('not_a_newer_version'); }
  catch { blockers.push('current_version_invalid'); }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(manifest.publishedAt) > now.getTime() + 5 * 60 * 1000) blockers.push('release_date_invalid');
  if (!Number.isSafeInteger(currentDatabaseSchema) || currentDatabaseSchema < manifest.database.min || currentDatabaseSchema > manifest.database.max) blockers.push('database_schema_unsupported');
  // No automatic migration path until reversible migration + recovery has been proven.
  if (manifest.database.migration !== 'none' || manifest.database.target !== currentDatabaseSchema) blockers.push('migration_not_yet_supported');
  if (!Number.isSafeInteger(availableBytes) || !artifact || availableBytes < 3 * artifact.bytes + MIN_FREE_OVERHEAD_BYTES) blockers.push('insufficient_disk_space');
  const completedAt = backup && typeof backup.completedAt === 'string' ? Date.parse(backup.completedAt) : NaN;
  if (!backup || backup.verified !== true || backup.restoreValidated !== true || backup.forVersion !== currentVersion || backup.includesDatabase !== true || backup.includesConfig !== true || backup.includesSecrets !== true || !Number.isFinite(completedAt) || completedAt > now.getTime() || completedAt < now.getTime() - 60 * 60 * 1000) blockers.push('fresh_verified_backup_required');
  if (adminConfirmedVersion !== manifest.version) blockers.push('explicit_manual_approval_required');
  return { allowed: blockers.length === 0, blockers, targetVersion: manifest.version, artifact: artifact ? { ...artifact } : null };
}
