#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only developer inspection. NOT a one-line production installer. */
import { inspectLocalHost } from '../src/lifecycle/native-preflight.mjs';

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--json')) {
  process.stderr.write('Usage: node scripts/inspect-native.mjs [--json]\n');
  process.exitCode = 2;
} else {
  try {
    const result = await inspectLocalHost();
    if (process.argv[2] === '--json') process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      const host = result.host;
      process.stdout.write('Domyro developer preflight (READ ONLY; DOES NOT INSTALL)\n');
      process.stdout.write(`Host: ${host.osId} ${host.versionId} ${host.arch}\n`);
      process.stdout.write(`CPU: ${host.cpuCount}; RAM: ${Math.floor(host.ramBytes/1024**3)} GiB; free disk: ${Math.floor(host.freeDiskBytes/1024**3)} GiB\n`);
      process.stdout.write(`Preliminary assessment: ${result.assessment.eligibleForPlanner ? 'eligible for further checks' : 'blocked'}\n`);
      if (result.assessment.blockers.length) process.stdout.write('Blocks: '+result.assessment.blockers.join(', ')+'\n');
      process.stdout.write('Not a production install decision. Actual version matrix, security, network and hardware verification are pending.\n');
    }
  } catch (error) {
    process.stderr.write('Read-only preflight failed: '+error.message+'\n');
    process.exitCode = 1;
  }
}
