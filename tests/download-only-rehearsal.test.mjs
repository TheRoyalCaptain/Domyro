// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { arch as hostArch } from 'node:os';
import { join } from 'node:path';
import { buildSignedSourceRelease } from '../tools/build-release.mjs';
import { rehearseSignedDownloadOnly } from '../src/lifecycle/download-only-rehearsal.mjs';
import { inspectActiveBundle } from '../src/lifecycle/transactional-release.mjs';

const arch = hostArch() === 'arm64' ? 'arm64' : 'amd64';
const keys = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' });
const publishedAt = '2026-11-01T12:00:00Z';
const now = new Date('2026-11-02T02:00:00Z');
const preferences = { automaticChecks: true, automaticDownloads: true, downloadDelayHours: 12 };
const sourcePromise = buildSignedSourceRelease({
  projectRoot: process.cwd(), version: '0.2.8', channel: 'stable',
  publishedAt, privateKeyPem: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
});
async function signed() {
  const doc = await sourcePromise;
  const file = 'domyro-0.2.8-ubuntu-' + arch + '.bundle.json';
  return {
    manifestBytes: doc.manifestBytes, signatureBase64: doc.signatureBase64,
    trustedPublicKeyPem, artifactBytes: doc.artifactBytes[file], file,
  };
}
async function fixture(t, responder) {
  const server = createServer(responder);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
function options(source, artifactUrl, overrides = {}) {
  return {
    manifestBytes: source.manifestBytes,
    signatureBase64: source.signatureBase64,
    trustedPublicKeyPem: source.trustedPublicKeyPem,
    currentVersion: '0.2.7', currentDatabaseSchema: 3,
    arch, now, preferences, artifactUrl, ...overrides,
  };
}

test('real loopback HTTP signed download stages, re-verifies and cleans without activation', async t => {
  const source = await signed();
  const origin = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream',
      'content-length': source.artifactBytes.length });
    res.end(source.artifactBytes);
  });
  let scratch;
  const got = await rehearseSignedDownloadOnly(options(source, origin + '/' + source.file, {
    onStaged: async ({ sandbox, root, version }) => {
      scratch = sandbox;
      assert.equal(await inspectActiveBundle(root), null);
      assert.match(await readFile(join(root, 'releases', version, 'src/server.mjs'), 'utf8'), /createDomyroServer/);
    },
  }));
  assert.equal(got.result, 'signed_download_only_rehearsal_passed');
  assert.equal(got.downloaded, true);
  assert.equal(got.verifiedSignature, true);
  assert.equal(got.verifiedHash, true);
  assert.equal(got.activated, false);
  assert.equal(got.serviceRestarted, false);
  assert.equal(got.installationApproved, false);
  await assert.rejects(() => access(scratch), /ENOENT/);
});

test('delay, disabled downloads and bad signatures reject before any HTTP request', async t => {
  const source = await signed();
  let hits = 0;
  const origin = await fixture(t, (_req, res) => { hits++; res.end(source.artifactBytes); });
  const url = origin + '/' + source.file;
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, url, {
    now: new Date('2026-11-01T13:00:00Z'),
  })), /signed_download_not_eligible/);
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, url, {
    preferences: { automaticChecks: true, automaticDownloads: false },
  })), /signed_download_not_eligible/);
  const other = generateKeyPairSync('ed25519');
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, url, {
    trustedPublicKeyPem: other.publicKey.export({ format: 'pem', type: 'spki' }),
  })), /signed_download_not_eligible/);
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, url, {
    currentDatabaseSchema: 99,
  })), /signed_download_not_eligible/);
  assert.equal(hits, 0);
});

test('rejects remote, redirected, credentialed and wrong-file URLs before HTTP', async t => {
  const source = await signed();
  const origin = await fixture(t, (_req, res) => { res.writeHead(302, { location: 'http://example.org/' }); res.end(); });
  for (const url of [
    'https://example.org/' + source.file,
    'http://127.0.0.2:9000/' + source.file,
    origin + '/not-' + source.file,
    origin + '/' + source.file + '?cache=1',
    origin.replace('http://', 'http://user:pass@') + '/' + source.file,
  ]) {
    await assert.rejects(() => rehearseSignedDownloadOnly(options(source, url)),
      /download_requires_exact_loopback_artifact_url/);
  }
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, origin + '/' + source.file)),
    /download_transport_failed|download_http_response_invalid/);
});

test('tampered bytes and incorrect Content-Length never produce a staged success', async t => {
  const source = await signed();
  const tampered = Buffer.from(source.artifactBytes);
  tampered[tampered.length - 1] ^= 1;
  const origin = await fixture(t, (req, res) => {
    if (req.url.startsWith('/length/')) {
      res.writeHead(200, { 'content-length': source.artifactBytes.length + 1 });
      res.end(source.artifactBytes);
    } else {
      res.writeHead(200, { 'content-length': tampered.length });
      res.end(tampered);
    }
  });
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, origin + '/' + source.file)),
    /download_artifact_hash_mismatch/);
  // The URL is intentionally strict; emulate a false declared length via a
  // same-name endpoint on a second local HTTP server.
  const mismatch = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-length': source.artifactBytes.length + 1 });
    res.end(source.artifactBytes);
  });
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, mismatch + '/' + source.file)),
    /download_declared_length_mismatch/);
});

test('excess bytes, HTTP errors and injected staging failure are rejected with cleanup', async t => {
  const source = await signed();
  const extra = Buffer.concat([source.artifactBytes, Buffer.from('untrusted')]);
  const origin = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'transfer-encoding': 'chunked' });
    res.end(extra);
  });
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, origin + '/' + source.file)),
    /download_exceeds_signed_size/);
  const bad = await fixture(t, (_req, res) => { res.writeHead(503); res.end('down'); });
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, bad + '/' + source.file)),
    /download_http_response_invalid/);
  const good = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-length': source.artifactBytes.length });
    res.end(source.artifactBytes);
  });
  let scratch;
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source, good + '/' + source.file, {
    onStaged: async ({ sandbox }) => {
      scratch = sandbox;
      throw new Error('injected_staging_failure');
    },
  })), /injected_staging_failure/);
  await assert.rejects(() => access(scratch), /ENOENT/);
});

test('unsupported host architecture never downloads', async () => {
  const source = await signed();
  await assert.rejects(() => rehearseSignedDownloadOnly(options(source,
    'http://127.0.0.1:3333/' + source.file,
    { arch: arch === 'amd64' ? 'arm64' : 'amd64' })),
  /download_architecture_mismatch/);
});
