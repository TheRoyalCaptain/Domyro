// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSignedSourceRelease } from '../tools/build-release.mjs';
import { verifySignedManifest } from '../src/lifecycle/release.mjs';
import { stageVerifiedBundle, switchActiveBundle, inspectActiveBundle } from '../src/lifecycle/transactional-release.mjs';
import { encryptBackupBytes, decryptBackupBytes } from '../src/lifecycle/encrypted-backup.mjs';

test('isolated failure-injection upgrade retains previous signed release and restorable test snapshot on both architectures', async t => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const trustedPublicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const previous = await buildSignedSourceRelease({
    projectRoot: process.cwd(), version: '0.1.1', channel: 'stable',
    publishedAt: '2026-10-30T12:00:00Z', privateKeyPem,
  });
  const target = await buildSignedSourceRelease({
    projectRoot: process.cwd(), version: '0.1.2', channel: 'stable',
    publishedAt: '2026-10-31T12:00:00Z', privateKeyPem,
  });

  const fixture = Buffer.from(JSON.stringify({ sampleOnly: true, users: 2, entities: 3, history: [42, 43] }));
  const secret = 'isolated-upgrade-fixture-passphrase-with-good-length';
  const snapshot = await encryptBackupBytes(fixture, secret);
  assert.deepEqual(await decryptBackupBytes(snapshot, secret), fixture);

  const dir = await mkdtemp(join(tmpdir(), 'domyro-end-to-end-proof-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const arch of ['amd64', 'arm64']) {
    const root = join(dir, arch);
    for (const signed of [previous, target]) {
      const manifest = verifySignedManifest({
        manifestBytes: signed.manifestBytes, signatureBase64: signed.signatureBase64, trustedPublicKeyPem,
      });
      const artifact = manifest.artifacts.find(a => a.arch === arch);
      assert.ok(artifact);
      await stageVerifiedBundle({
        root, ...signed, trustedPublicKeyPem, artifactBytes: signed.artifactBytes[artifact.file], arch,
      });
    }
    assert.equal(await inspectActiveBundle(root), null);
    await switchActiveBundle({
      root, version: '0.1.1', confirmedVersion: '0.1.1',
      verifiedBackup: true, trustedPublicKeyPem, probe: async () => true,
    });
    assert.equal(await inspectActiveBundle(root), '0.1.1');

    // Inject a failing post-switch health result for the new release.
    await assert.rejects(() => switchActiveBundle({
      root, version: '0.1.2', confirmedVersion: '0.1.2',
      verifiedBackup: true, trustedPublicKeyPem, probe: async () => false,
    }), /health_failed_rolled_back_pointer/);
    assert.equal(await inspectActiveBundle(root), '0.1.1');

    // Program files from both versions and encrypted bytes remain available.
    assert.match(await readFile(join(root, 'current', 'src/server.mjs'), 'utf8'), /createDomyroServer/);
    assert.deepEqual(await decryptBackupBytes(snapshot, secret), fixture);
  }
});
