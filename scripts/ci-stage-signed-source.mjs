// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Create a signed *development* source tree for a disposable hosted CI
 * systemd test. Ephemeral test keys are generated in memory, NEVER published
 * or accepted as official release keys. No real system installation.
 */
import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { arch, tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSignedSourceRelease, writeSignedRelease } from '../tools/build-release.mjs';
import { inspectOfflineNativeSourceRelease } from '../src/lifecycle/native-release-verifier.mjs';
import { recordTrustedReleaseReceipt, readTrustedReleaseReceipt } from '../src/lifecycle/trusted-release-receipt.mjs';
import {
  stageVerifiedBundle, inspectVerifiedStagedBundle,
} from '../src/lifecycle/transactional-release.mjs';

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      process.env.DOMYRO_CI_SYSTEMD_ALLOWED !== '1' ||
      process.env.RUNNER_OS !== 'Linux' ||
      process.env.USER !== 'runner' || !workspace ||
      resolve(process.cwd()) !== resolve(workspace) ||
      process.argv.length !== 3) {
    throw new Error('ci_signed_stage_requires_disposable_hosted_runner');
  }
  const root = resolve(process.argv[2]);
  const expectedPrefix = resolve(workspace) + sep + '.domyro-ci-signed-';
  if (!root.startsWith(expectedPrefix) || !root.endsWith(sep + 'release-store')) {
    throw new Error('ci_signed_stage_target_not_isolated');
  }
  const platform = { x64: 'amd64', arm64: 'arm64' }[arch()];
  if (!platform) throw new Error('ci_signed_stage_arch_unsupported');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const trustedPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const signed = await buildSignedSourceRelease({
    projectRoot: workspace,
    version: '0.1.1',
    channel: 'stable',
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  // The actual installer boundary must read signed bytes FROM DISK, not
  // rely only on a build function's already-verified in-memory return value.
  // This temporary package exists only in this GitHub-hosted CI workspace.
  const packageDirectory = join(root, '..', 'offline-signed-package');
  await writeSignedRelease(packageDirectory, signed);
  const artifact = 'domyro-0.1.1-ubuntu-' + platform + '.bundle.json';
  const expectedPublicKeySha256 = createHash('sha256').update(
    publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  // Test-only fault injection can corrupt the detached signature/artifact
  // before admission. A production/native release never accepts this flag.
  const sabotage = process.env.DOMYRO_CI_SIGNED_PACKAGE_FAULT ?? '';
  if (sabotage && process.env.DOMYRO_CI_SIGNED_ADMISSION_MATRIX !== '1') {
    throw new Error('ci_signed_package_fault_injection_not_authorized');
  }
  if (sabotage === 'artifact') {
    const filePath = join(packageDirectory, artifact);
    const bytes = await readFile(filePath);
    bytes[bytes.length - 3] ^= 1;
    await writeFile(filePath, bytes);
  } else if (sabotage === 'signature') {
    await writeFile(join(packageDirectory, 'release-manifest.sig'), 'not-a-valid-ed25519-signature\\n');
  } else if (sabotage === 'extra') {
    await writeFile(join(packageDirectory, 'unlisted-source.js'), 'not admitted\\n');
  } else if (sabotage !== '' && sabotage !== 'receipt') {
    throw new Error('ci_signed_package_fault_unknown');
  }
  const approved = await inspectOfflineNativeSourceRelease({
    directory: packageDirectory, trustedPublicKeyPem,
    expectedPublicKeySha256, architecture: platform,
    databaseSchema: 3, channel: 'stable',
  });
  if (!approved.signatureVerified || !approved.allArtifactsVerified ||
      approved.canInstall || approved.canExecute || approved.installationGate !== 'D-53') {
    throw new Error('ci_offline_signed_package_admission_invalid');
  }
  // Validate the isolated file-backed package and then check the extracted
  // source tree again before the real (disposable) systemd test uses it.
  const manifestBytes = await readFile(join(packageDirectory, 'release-manifest.json'));
  const signatureBase64 = (await readFile(join(packageDirectory, 'release-manifest.sig'), 'utf8')).trimEnd();

  // Demonstrate the durable release high-water receipt from PR #1 against
  // the same authenticated *file-backed* bytes. Its test-only trust store
  // is created outside the owner's host and discarded after the CI proof.
  const receiptDir = await mkdtemp(join(tmpdir(), 'domyro-test-'));
  try {
    const stored = await recordTrustedReleaseReceipt({
      directory: receiptDir, manifestBytes, signatureBase64, trustedPublicKeyPem,
    });
    if (stored.manifestSha256 !== approved.manifestSha256 ||
        stored.publisherKeySha256 !== approved.publisherFingerprint ||
        stored.version !== approved.version ||
        stored.installAllowed !== false) {
      throw new Error('ci_release_trust_receipt_mismatch');
    }
    if (sabotage === 'receipt') {
      const filename = join(receiptDir, '.trusted-release-receipt.json');
      const changed = JSON.parse(await readFile(filename, 'utf8'));
      changed.manifestSha256 = 'f'.repeat(64);
      await writeFile(filename, JSON.stringify(changed) + '\n', { mode: 0o600 });
    }
    const readBack = await readTrustedReleaseReceipt({
      directory: receiptDir, trustedPublicKeyPem,
    });
    if (!readBack || readBack.version !== approved.version ||
        readBack.manifestSha256 !== approved.manifestSha256 ||
        readBack.publisherKeySha256 !== expectedPublicKeySha256) {
      throw new Error('ci_release_trust_receipt_changed');
    }
  } finally { await rm(receiptDir, { recursive:true, force:true }); }

  const artifactBytes = await readFile(join(packageDirectory, artifact));
  const staged = await stageVerifiedBundle({
    root, manifestBytes, signatureBase64, trustedPublicKeyPem,
    artifactBytes, arch: platform,
  });
  await inspectVerifiedStagedBundle({
    root, version: staged.version, trustedPublicKeyPem, expectedArch: platform,
  });
  // Evidence for the CI-only first-boot journal. This file lives OUTSIDE the
  // immutable signed package, is never shipped, and is never installer authority.
  await writeFile(join(root,'..','ci-signed-admission.json'),JSON.stringify({
    verified:true,gate:'D-53',version:approved.version,
    architecture:platform,manifestSha256:approved.manifestSha256,
    publisherKeySha256:approved.publisherFingerprint,
  })+'\n',{flag:'wx',mode:0o600});
  // Only emit the verified path. The private test signing key is discarded.
  process.stdout.write(join(root, 'releases', staged.version) + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error('CI-only signed staging failed: ' + error.message);
    process.exitCode = 1;
  });
}
