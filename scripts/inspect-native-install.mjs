#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Developer diagnostic only. NO install, package commands, sockets, SSH,
 * privilege escalation, credential inspection or host writes.
 */
import { inspectNativeInstallEvidence } from '../src/lifecycle/native-install-evidence.mjs';

function argumentsToOptions(args) {
  let json = false;
  let requestedPort = 8844;
  let portSupplied = false;
  for (const arg of args) {
    if (arg === '--json' && !json) { json = true; continue; }
    if (/^--port=[0-9]{1,5}$/.test(arg) && !portSupplied) {
      requestedPort = Number(arg.slice('--port='.length));
      portSupplied = true;
      continue;
    }
    throw new Error('Usage: node scripts/inspect-native-install.mjs [--json] [--port=8844]');
  }
  return { json, requestedPort };
}

try {
  const options = argumentsToOptions(process.argv.slice(2));
  const result = await inspectNativeInstallEvidence(options);
  if (options.json) {
    process.stdout.write(JSON.stringify(result,null,2) + '\n');
  } else {
    const status=result.assessment;
    process.stdout.write('Domyro native installer evidence (DIAGNOSTIC ONLY, D-53 CLOSED)\n');
    process.stdout.write('Host: '+result.host.osId+' '+result.host.versionId+' '+result.host.arch+'\n');
    process.stdout.write('Port '+status.inspectedPort+': '+status.portObservation+
      ' (kernel snapshot, NOT a future reservation)\n');
    process.stdout.write('Plan checks: '+(status.planCanProceed?'passed':'blocked')+'\n');
    for (const blocker of status.blockers) process.stdout.write('BLOCK: '+blocker+'\n');
    for (const notice of status.notices) process.stdout.write('NOTE: '+notice+'\n');
    process.stdout.write('Installation allowed: NEVER. No files or services modified.\n');
  }
} catch (error) {
  process.stderr.write('Native preflight diagnostic failed: '+error.message+'\n');
  process.exitCode = 1;
}
