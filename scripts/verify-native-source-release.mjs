#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline source-release inspection ONLY. Never downloads, installs, extracts,
 * executes code, writes to the filesystem or requests elevated privileges.
 *
 * Caller MUST obtain the pinned publisher fingerprint from a separate trusted
 * channel. An untrusted release MUST NOT supply its own trusted fingerprint.
 */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectOfflineNativeSourceRelease } from '../src/lifecycle/native-release-verifier.mjs';

function options(args) {
  const supplied = new Map();
  const accepted = new Set(['directory','publisher-key','publisher-fingerprint','arch','schema','channel']);
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !accepted.has(match[1]) || supplied.has(match[1])) {
      throw new Error('invalid_or_duplicate_release_verifier_argument');
    }
    supplied.set(match[1], match[2]);
  }
  for (const key of ['directory','publisher-key','publisher-fingerprint','arch','schema']) {
    if (!supplied.has(key)) throw new Error('missing_required_release_verifier_argument:' + key);
  }
  const number = supplied.get('schema');
  if (!/^(0|[1-9][0-9]{0,8})$/.test(number)) throw new Error('invalid_database_schema_argument');
  return {
    directory: supplied.get('directory'),
    keyFile: supplied.get('publisher-key'),
    expectedPublicKeySha256: supplied.get('publisher-fingerprint'),
    architecture: supplied.get('arch'),
    databaseSchema: Number(number),
    channel: supplied.get('channel') ?? 'stable',
  };
}

async function readKey(path) {
  const absolute = resolve(path);
  const before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > 16 * 1024 || (before.mode & 0o022) !== 0) {
    throw new Error('publisher_key_file_unsafe');
  }
  const fd = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) {
      throw new Error('publisher_key_file_changed');
    }
    const bytes = await fd.readFile('utf8');
    const after = await fd.stat();
    if (after.size !== stat.size || after.ino !== stat.ino) throw new Error('publisher_key_file_changed');
    return bytes;
  } finally {
    await fd.close();
  }
}

async function main() {
  const config = options(process.argv.slice(2));
  const trustedPublicKeyPem = await readKey(config.keyFile);
  const result = await inspectOfflineNativeSourceRelease({
    ...config, trustedPublicKeyPem,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    // Never print private key material, file content or a stack trace.
    console.error('Domyro offline source verifier refused: ' + error.message);
    process.exitCode = 1;
  });
}
