// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessUbuntuHost } from '../src/lifecycle/native-preflight.mjs';

const base = { platform: 'linux', osId: 'ubuntu', versionId: '24.04', isLts: true, cpuCount: 4, ramBytes: 8 * 1024 ** 3, freeDiskBytes: 40 * 1024 ** 3, portAvailable: true };
test('Ubuntu LTS arm64 and amd64 mapped without side effects', () => {
  for (const [arch, expected] of [['arm64', 'arm64'], ['x64', 'amd64']]) {
    const result = assessUbuntuHost({ ...base, arch });
    assert.equal(result.eligibleForPlanner, true);
    assert.equal(result.sideEffects, false);
    assert.equal(result.mappedArchitecture, expected);
  }
});
test('unsupported host or shortage fails safely', () => {
  const result = assessUbuntuHost({ ...base, platform: 'darwin', arch: 'x64', freeDiskBytes: 1, ramBytes: 1 });
  assert.equal(result.eligibleForPlanner, false);
  assert.ok(result.blockers.includes('ubuntu_required'));
  assert.ok(result.blockers.includes('insufficient_disk'));
  assert.ok(result.blockers.includes('insufficient_memory'));
});
