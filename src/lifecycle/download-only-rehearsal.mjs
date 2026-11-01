// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI-only download-and-stage rehearsal for signed source bundles.
 *
 * A deliberately loopback-only transport proves the real HTTP byte stream,
 * bounded buffering, signed metadata, SHA-256 and private staging without
 * permitting arbitrary URLs, activation, systemd or owner-host access.
 * This is NOT the production update downloader or a deployment entry point.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { arch as hostArch, tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessSignedUpdateCandidate } from './update-center.mjs';
import { verifySignedManifest } from './release.mjs';
import {
  stageVerifiedBundle, inspectVerifiedStagedBundle, inspectActiveBundle,
} from './transactional-release.mjs';

const ARCH = Object.freeze({ x64: 'amd64', arm64: 'arm64' });
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

function checkedLocalUrl(value, expectedFile) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('download_url_invalid'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.hash || url.search ||
      url.pathname !== '/' + expectedFile) {
    throw new Error('download_requires_exact_loopback_artifact_url');
  }
  return url.href;
}

async function downloadBounded(url, expected, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let reader;
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { accept: 'application/octet-stream' },
    });
    if (!response || response.status !== 200 || !response.body ||
        typeof response.body.getReader !== 'function') {
      throw new Error('download_http_response_invalid');
    }
    const declared = response.headers?.get('content-length');
    if (declared !== null && declared !== undefined &&
        (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) !== expected.bytes)) {
      throw new Error('download_declared_length_mismatch');
    }
    reader = response.body.getReader();
    const chunks = [];
    const hash = createHash('sha256');
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('download_chunk_invalid');
      total += value.byteLength;
      if (total > expected.bytes || total > MAX_BUNDLE_BYTES) {
        throw new Error('download_exceeds_signed_size');
      }
      const bytes = Buffer.from(value);
      hash.update(bytes);
      chunks.push(bytes);
    }
    if (total !== expected.bytes) throw new Error('download_length_mismatch');
    if (hash.digest('hex') !== expected.sha256) throw new Error('download_artifact_hash_mismatch');
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error.message?.startsWith('download_')) throw error;
    throw new Error('download_transport_failed', { cause: error });
  } finally {
    clearTimeout(timeout);
    if (reader) await reader.cancel().catch(() => {});
  }
}

/**
 * Requires automatic checks AND explicitly enabled automatic downloads.
 * Download-delay eligibility is enforced, but never grants install consent.
 * The only permitted HTTP destination is 127.0.0.1 with the exact signed
 * artifact filename, so this function cannot poll a live production feed.
 *
 * onStaged is an isolated CI test hook; the temporary files are always erased.
 */
export async function rehearseSignedDownloadOnly({
  manifestBytes, signatureBase64, trustedPublicKeyPem,
  currentVersion, currentDatabaseSchema, preferences,
  now, arch = ARCH[hostArch()], artifactUrl,
  fetchImpl = globalThis.fetch, onStaged = async () => {},
} = {}) {
  if (arch !== ARCH[hostArch()]) throw new Error('download_architecture_mismatch');
  if (typeof fetchImpl !== 'function' || typeof onStaged !== 'function') {
    throw new TypeError('download_rehearsal_hook_invalid');
  }
  const advice = assessSignedUpdateCandidate({
    manifestBytes, signatureBase64, trustedPublicKeyPem,
    currentVersion, currentDatabaseSchema, preferences, now, arch,
  });
  if (advice.state !== 'download_eligible' || advice.mayDownloadAutomatically !== true) {
    throw new Error('signed_download_not_eligible');
  }
  const manifest = verifySignedManifest({ manifestBytes, signatureBase64, trustedPublicKeyPem });
  const artifact = manifest.artifacts.find(a => a.os === 'ubuntu' && a.arch === arch);
  if (!artifact || artifact.bytes > MAX_BUNDLE_BYTES) throw new Error('download_artifact_size_unsupported');
  const url = checkedLocalUrl(artifactUrl, artifact.file);
  // No files or service changes are made until signature, policy and URL pass.
  const sandbox = await mkdtemp(join(tmpdir(), 'domyro-download-only-test-'));
  try {
    const bytes = await downloadBounded(url, artifact, fetchImpl);
    const root = join(sandbox, 'release-root');
    const staged = await stageVerifiedBundle({
      root, manifestBytes, signatureBase64, trustedPublicKeyPem,
      artifactBytes: bytes, arch,
    });
    await inspectVerifiedStagedBundle({
      root, version: staged.version, trustedPublicKeyPem, expectedArch: arch,
    });
    if (await inspectActiveBundle(root) !== null) throw new Error('download_unexpected_activation');
    await onStaged({ sandbox, root, version: staged.version, artifactBytes: bytes });
    // The test hook represents time spent awaiting an operator/worker.
    // Re-authenticate the staged tree afterwards to catch TOCTOU tampering.
    await inspectVerifiedStagedBundle({
      root, version: staged.version, trustedPublicKeyPem, expectedArch: arch,
    });
    if (await inspectActiveBundle(root) !== null) throw new Error('download_hook_activated_release');
    return Object.freeze({
      result: 'signed_download_only_rehearsal_passed',
      version: staged.version, arch, bytes: bytes.length,
      verifiedSignature: true, verifiedHash: true,
      downloaded: true, staged: true, activated: false,
      serviceRestarted: false, databaseMigrated: false,
      hostModified: false, installationApproved: false, gate: 'D-53',
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}
