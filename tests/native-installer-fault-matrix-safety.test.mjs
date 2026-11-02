// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const matrix = resolve('scripts/ci-native-installer-fault-matrix.sh');
const installer = resolve('scripts/ci-native-account-test.sh');
const base = {
  ...process.env,
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  RUNNER_OS: 'Linux',
  DOMYRO_CI_SYSTEMD_ALLOWED: '1',
  DOMYRO_CI_PG_ONBOARDING: '1',
  DOMYRO_CI_FAULT_MATRIX: '1',
  DOMYRO_TEST_DATABASE_URL: 'postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test',
  GITHUB_RUN_ID: '12345678901',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKSPACE: process.cwd(),
};
test('native installer failure rehearsal rejects any non-hosted or wrong-database execution', () => {
  const invalid = [
    { GITHUB_ACTIONS: 'false' },
    { RUNNER_ENVIRONMENT: 'self-hosted' },
    { RUNNER_OS: 'Windows' },
    { DOMYRO_CI_SYSTEMD_ALLOWED: '0' },
    { DOMYRO_CI_PG_ONBOARDING: '0' },
    { DOMYRO_CI_FAULT_MATRIX: '0' },
    { DOMYRO_TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/postgres' },
    { GITHUB_RUN_ID: '../etc' },
    { GITHUB_RUN_ATTEMPT: '1;rm' },
    { USER: 'not-runner' },
  ];
  for (const override of invalid) {
    const result = spawnSync('bash', [matrix], {
      env: { ...base, ...override }, cwd: process.cwd(),
      timeout: 5000, encoding: 'utf8',
    });
    assert.equal(result.status, 90, JSON.stringify(override) + ' ' + result.stderr);
    assert.match(result.stderr, /Refusing native installer fault matrix/);
  }
});
test('native installer refuses unknown injected failure points before privileged operations', () => {
  // This guard can only be reached on the hosted runner; locally the stronger
  // runner identity guard rejects it even sooner.
  const result = spawnSync('bash', [installer], {
    env: { ...base, DOMYRO_CI_FAILPOINT: 'after-apt-any-host' },
    cwd: process.cwd(), timeout: 5000, encoding: 'utf8',
  });
  assert.ok([90, 98].includes(result.status), result.stderr);
});
test('native installer failure scripts remain syntactically valid Bash', () => {
  const result = spawnSync('bash', ['-n', installer, matrix], {
    timeout: 5000, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
