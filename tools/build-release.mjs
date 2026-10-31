// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit developer-only release packer. Makes portable SOURCE artifacts and
 * Ed25519-signed metadata. This does not publish GitHub Releases or install.
 * The signing private key must never be added to the repository.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignedManifest, verifyArtifactBytes } from '../src/lifecycle/release.mjs';

const ALLOWLIST = Object.freeze([
  'package.json', 'src/server.mjs', 'src/lib/http.mjs',
  'src/domain/permissions.mjs', 'src/domain/state.mjs',
  'web/index.html', 'web/assets/app.js', 'web/assets/styles.css', 'web/favicon.svg',
]);
const FILE_LIMIT = 8 * 1024 * 1024;
const BUNDLE_LIMIT = 64 * 1024 * 1024;

async function collectFiles(projectRoot) {
  const files = [];
  for (const path of ALLOWLIST) {
    const absolute = join(projectRoot, path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > FILE_LIMIT) throw new Error('release_file_invalid:' + path);
    const bytes = await readFile(absolute);
    files.push({ path, base64: bytes.toString('base64') });
  }
  return files;
}

export async function buildSignedSourceRelease({ projectRoot, version, channel, publishedAt, privateKeyPem }) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('invalid_release_version');
  if (!['stable', 'beta'].includes(channel)) throw new Error('invalid_channel');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) throw new Error('invalid_release_timestamp');
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('ed25519_signing_key_required');
  const sourceFiles = await collectFiles(resolve(projectRoot));
  const artifacts = [], artifactBytes = {};
  for (const arch of ['amd64', 'arm64']) {
    // JS source is architecture-neutral. Native Node runtimes and system
    // dependencies MUST be sourced, pinned and validated separately.
    const archive = Buffer.from(JSON.stringify({ schemaVersion: 1, files: sourceFiles }));
    if (archive.byteLength > BUNDLE_LIMIT) throw new Error('bundle_too_large');
    const file = 'domyro-' + version + '-ubuntu-' + arch + '.bundle.json';
    artifacts.push({ os: 'ubuntu', arch, file, sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.byteLength });
    artifactBytes[file] = archive;
  }
  const manifest = {
    schemaVersion: 1, version, channel, publishedAt,
    database: { min: 0, max: 0, target: 0, migration: 'none' },
    artifacts,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const signatureBase64 = sign(null, manifestBytes, key).toString('base64');
  return Object.freeze({ manifestBytes, signatureBase64, artifactBytes });
}

export async function writeSignedRelease(output, signed) {
  const dir = resolve(output);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Use exclusive writes so an accidental rerun does not overwrite approved
  // signed artifacts, and don't write any private keys to output.
  for (const [filename, bytes] of Object.entries(signed.artifactBytes)) {
    await writeFile(join(dir, filename), bytes, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(join(dir, 'release-manifest.json'), signed.manifestBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(dir, 'release-manifest.sig'), signed.signatureBase64 + '\n', { flag: 'wx', mode: 0o600 });
  return Object.freeze({ output: dir, files: Object.keys(signed.artifactBytes).length + 2 });
}

async function cli() {
  if (process.argv.length !== 7) {
    throw new Error('Usage: node tools/build-release.mjs <project-root> <output-dir> <version> <stable|beta> <private-key-file>');
  }
  const [, , projectRoot, output, version, channel, keyFile] = process.argv;
  const privateKeyPem = await readFile(keyFile, 'utf8');
  const signed = await buildSignedSourceRelease({
    projectRoot, version, channel, privateKeyPem,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  // Never print private key contents.
  await writeSignedRelease(output, signed);
  console.log('Signed development source artifacts created at ' + output + ' (NOT production packages)');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  cli().catch(e => { console.error(e.message); process.exitCode = 1; });
}
