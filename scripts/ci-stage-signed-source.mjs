// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Create a signed *development* source tree for a disposable hosted CI
 * systemd test. Ephemeral test keys are generated in memory, NEVER published
 * or accepted as official release keys. No real system installation.
 */
import { generateKeyPairSync } from 'node:crypto';
import { arch } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSignedSourceRelease } from '../tools/build-release.mjs';
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
  const artifact = 'domyro-0.1.1-ubuntu-' + platform + '.bundle.json';
  const staged = await stageVerifiedBundle({
    root, manifestBytes: signed.manifestBytes,
    signatureBase64: signed.signatureBase64, trustedPublicKeyPem,
    artifactBytes: signed.artifactBytes[artifact], arch: platform,
  });
  await inspectVerifiedStagedBundle({
    root, version: staged.version, trustedPublicKeyPem, expectedArch: platform,
  });
  // Only emit the verified path. The private test signing key is discarded.
  process.stdout.write(join(root, 'releases', staged.version) + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error('CI-only signed staging failed: ' + error.message);
    process.exitCode = 1;
  });
}
