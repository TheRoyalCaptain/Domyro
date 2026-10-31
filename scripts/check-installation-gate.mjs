#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function assessOwnerInstallationGate(record) {
  if (!record || record.schemaVersion !== 1 || record.ownerDecision !== 'D-53' || !record.checks || typeof record.checks !== 'object' || Array.isArray(record.checks)) throw new Error('installation_gate_record_invalid');
  const entries = Object.entries(record.checks);
  if (!entries.length || entries.some(([name, passed]) => !name || typeof passed !== 'boolean')) throw new Error('installation_gate_check_invalid');
  if (record.readyForOwnerInstallation !== true && record.readyForOwnerInstallation !== false) throw new Error('installation_gate_status_invalid');
  if (record.ownerDeploymentConsentRecorded !== true && record.ownerDeploymentConsentRecorded !== false) throw new Error('deployment_consent_status_invalid');
  const blockers = entries.filter(([, passed]) => passed !== true).map(([name]) => name);
  const releaseReady = record.readyForOwnerInstallation === true && blockers.length === 0;
  const ready = releaseReady && record.ownerDeploymentConsentRecorded === true;
  if (record.readyForOwnerInstallation === true && blockers.length) throw new Error('installation_gate_claims_ready_with_blockers');
  return Object.freeze({ releaseReady, ready, ownerConsent: record.ownerDeploymentConsentRecorded, blockers: Object.freeze(blockers) });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === new URL('file://' + process.argv[1]).href;
if (isMain) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && !['--require-ready', '--require-release'].includes(process.argv[2]))) throw new Error('Usage: node scripts/check-installation-gate.mjs [--require-ready|--require-release]');
    const raw = await readFile(new URL('../config/installation-readiness.json', import.meta.url), 'utf8');
    const result = assessOwnerInstallationGate(JSON.parse(raw));
    process.stdout.write(JSON.stringify({ ...result, summary: result.ready ? 'READY (independent evidence still required)' : 'NOT READY - do not install on owner server' }, null, 2) + '\n');
    if (process.argv[2] === '--require-ready' && !result.ready) process.exitCode = 2;
    if (process.argv[2] === '--require-release' && !result.releaseReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write('Installation gate invalid: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
