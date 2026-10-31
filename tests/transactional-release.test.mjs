// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, lstat, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageVerifiedBundle, switchActiveBundle, inspectActiveBundle } from '../src/lifecycle/transactional-release.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
function release(version, files, arch = 'amd64') {
  const artifactBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, files: files.map(([path, text]) => ({ path, base64: Buffer.from(text).toString('base64') })),
  }));
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, version, channel: 'stable', publishedAt: '2026-10-31T12:00:00Z',
    database: { min: 0, max: 0, target: 0, migration: 'none' },
    artifacts: [{ os: 'ubuntu', arch, file: 'domyro-' + version + '.json', bytes: artifactBytes.length, sha256: createHash('sha256').update(artifactBytes).digest('hex') }],
  }));
  return { artifactBytes, manifestBytes, signatureBase64: sign(null, manifestBytes, privateKey).toString('base64'), trustedPublicKeyPem, arch };
}

test('trusted staging is inert and explicit manual switching reverts if health fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domyro-staging-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = release('0.1.0', [['src/server.mjs', 'v1'], ['package.json', '{"version":"0.1.0"}']]);
  const second = release('0.1.1', [['src/server.mjs', 'v2']]);
  assert.equal((await stageVerifiedBundle({ root, ...first })).activated, false);
  assert.equal(await inspectActiveBundle(root), null);
  await assert.rejects(() => switchActiveBundle({ root, version: '0.1.0', confirmedVersion: null, verifiedBackup: true, trustedPublicKeyPem, probe: async () => true }), /confirmation/);
  await assert.rejects(() => switchActiveBundle({ root, version: '0.1.0', confirmedVersion: '0.1.0', verifiedBackup: false, trustedPublicKeyPem, probe: async () => true }), /backup/);
  await switchActiveBundle({ root, version: '0.1.0', confirmedVersion: '0.1.0', verifiedBackup: true, trustedPublicKeyPem, probe: async () => true });
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  await stageVerifiedBundle({ root, ...second });
  await assert.rejects(() => switchActiveBundle({ root, version: '0.1.1', confirmedVersion: '0.1.1', verifiedBackup: true, trustedPublicKeyPem, probe: async () => false }), /health_failed/);
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  const result = await switchActiveBundle({ root, version: '0.1.1', confirmedVersion: '0.1.1', verifiedBackup: true, trustedPublicKeyPem, probe: async ({ release }) => (await readFile(join(release, 'src/server.mjs'), 'utf8')) === 'v2' });
  assert.equal(result.previous, '0.1.0');
  assert.equal(result.serviceRestarted, false);
  assert.equal(result.databaseMigrated, false);
  assert.equal((await lstat(join(root, 'releases/0.1.0'))).isDirectory(), true);
  assert.equal(await readlink(join(root, 'current')), 'releases/0.1.1');
});

test('rejects forged artifacts, path traversal, modified staged files and invalid versions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domyro-staging-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = release('0.1.0', [['src/main.js', 'safe']]);
  await assert.rejects(() => stageVerifiedBundle({ root, ...first, artifactBytes: Buffer.from('tamper') }), /hash_mismatch/);
  await assert.rejects(() => stageVerifiedBundle({ root, ...release('0.1.0', [['../evil', 'no']]) }), /bundle_path_invalid/);
  await assert.rejects(() => stageVerifiedBundle({ root, ...release('0.1.0', [['src', 'file'], ['src/x.js', 'child']]) }), /bundle_path_conflict/);
  await stageVerifiedBundle({ root, ...first });
  await writeFile(join(root, 'releases/0.1.0/src/main.js'), 'MODIFIED');
  await assert.rejects(() => switchActiveBundle({ root, version: '0.1.0', confirmedVersion: '0.1.0', verifiedBackup: true, trustedPublicKeyPem, probe: async () => true }), /staged_release_file_changed/);
  await assert.rejects(() => stageVerifiedBundle({ root, ...first }), /already_staged/);
  await assert.rejects(() => switchActiveBundle({ root, version: '../../etc', confirmedVersion: '../../etc', verifiedBackup: true, trustedPublicKeyPem, probe: async () => true }), /unsafe_version/);
  assert.equal(await inspectActiveBundle(root), null);
});
