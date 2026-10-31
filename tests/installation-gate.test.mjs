// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessOwnerInstallationGate } from '../scripts/check-installation-gate.mjs';

test('official D-53 deployment gate remains CLOSED until all integrated and manual conditions pass', async () => {
  const record = JSON.parse(await readFile(new URL('../config/installation-readiness.json', import.meta.url), 'utf8'));
  const result = assessOwnerInstallationGate(record);
  assert.equal(result.ready, false);
  assert.equal(result.ownerConsent, false);
  assert.ok(result.blockers.includes('secureOwnerOnboarding'));
  assert.ok(result.blockers.includes('updateFailureRollback'));
  assert.equal(result.releaseReady, false);
});

test('cannot advertise ready if a required check is false; positive readiness needs explicit owner consent', () => {
  const checks = { a: true, b: true };
  const releaseOnly = assessOwnerInstallationGate({ schemaVersion: 1, ownerDecision: 'D-53', readyForOwnerInstallation: true, ownerDeploymentConsentRecorded: false, checks });
  assert.equal(releaseOnly.ready, false);
  assert.equal(releaseOnly.releaseReady, true);
  assert.equal(assessOwnerInstallationGate({ schemaVersion: 1, ownerDecision: 'D-53', readyForOwnerInstallation: true, ownerDeploymentConsentRecorded: true, checks }).ready, true);
  assert.throws(() => assessOwnerInstallationGate({ schemaVersion: 1, ownerDecision: 'D-53', readyForOwnerInstallation: true, ownerDeploymentConsentRecorded: true, checks: { a: true, b: false } }), /claims_ready_with_blockers/);
  assert.throws(() => assessOwnerInstallationGate({ schemaVersion: 1, ownerDecision: 'D-53', readyForOwnerInstallation: true, ownerDeploymentConsentRecorded: true, checks: { a: 'true' } }), /check_invalid/);
});
