// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSignedSourceRelease, writeSignedRelease } from '../tools/build-release.mjs';
import { verifyArtifactBytes, verifySignedManifest } from '../src/lifecycle/release.mjs';
import { stageVerifiedBundle, inspectActiveBundle } from '../src/lifecycle/transactional-release.mjs';

test('builds reproducible amd64 and arm64 source bundles with an external test signing key', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'domyro-build-proof-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const keys = generateKeyPairSync('ed25519');
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const input = {
    projectRoot: process.cwd(), version: '0.1.1', channel: 'stable',
    publishedAt: '2026-10-31T12:00:00Z', privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  const first = await buildSignedSourceRelease(input);
  const second = await buildSignedSourceRelease(input);
  assert.deepEqual(first.manifestBytes, second.manifestBytes);
  assert.equal(first.signatureBase64, second.signatureBase64);
  const manifest = verifySignedManifest({ manifestBytes: first.manifestBytes, signatureBase64: first.signatureBase64, trustedPublicKeyPem: publicPem });
  assert.deepEqual(manifest.artifacts.map(x => x.arch), ['amd64', 'arm64']);
  for (const art of manifest.artifacts) assert.equal(verifyArtifactBytes(art, first.artifactBytes[art.file]), true);
  const output = join(folder, 'package');
  const receipt = await writeSignedRelease(output, first);
  assert.equal(receipt.files, 4);
  assert.equal((await readdir(output)).length, 4);
  assert.deepEqual(await readFile(join(output, 'release-manifest.json')), first.manifestBytes);
  await assert.rejects(() => writeSignedRelease(output, first), /EEXIST/);
  const staged = await stageVerifiedBundle({
    root: join(folder, 'isolated-store'), manifestBytes: first.manifestBytes,
    signatureBase64: first.signatureBase64, trustedPublicKeyPem: publicPem,
    artifactBytes: first.artifactBytes[manifest.artifacts[0].file], arch: 'amd64',
  });
  assert.equal(staged.activated, false);
  assert.equal(await inspectActiveBundle(join(folder, 'isolated-store')), null);
  const app = await readFile(join(folder, 'isolated-store', 'releases', '0.1.1', 'src/server.mjs'), 'utf8');
  assert.ok(app.includes('createDomyroServer'));
});

test('rejects invalid production signing requirements and malformed release inputs', async () => {
  const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const valid = generateKeyPairSync('ed25519');
  const base = { projectRoot: process.cwd(), version: '0.1.1', channel: 'stable', publishedAt: '2026-10-31T12:00:00Z', privateKeyPem: valid.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  await assert.rejects(() => buildSignedSourceRelease({ ...base, privateKeyPem: wrong.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), /ed25519/);
  await assert.rejects(() => buildSignedSourceRelease({ ...base, version: '../../1' }), /invalid_release_version/);
  await assert.rejects(() => buildSignedSourceRelease({ ...base, channel: 'latest' }), /invalid_channel/);
});
