#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Run from a root-owned supervisor copy OUTSIDE the active release directory.
// The systemd unit must hold flock on /run/domyro-updater/worker.lock.
import {readFile,lstat,chmod,unlink} from 'node:fs/promises';
import {createNativeUpdateJob} from '../src/lifecycle/native-update-job.mjs';
import {createNativeUpdateHost} from '../src/lifecycle/native-update-host.mjs';
import {createUpdateWorkerServer} from '../src/lifecycle/update-worker-ipc.mjs';
import {assessOwnerInstallationGate} from './check-installation-gate.mjs';
import {validatePublisherTrustPolicy} from '../src/lifecycle/publisher-trust-policy.mjs';
import {selectNativeReleasePackage} from '../src/lifecycle/native-release-cache.mjs';

async function privateJson(path) {
  const s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)!==0||s.size>65536)
    throw Error('update_worker_private_configuration_required');
  return JSON.parse(await readFile(path,'utf8'));
}
async function main() {
  if(process.getuid?.()!==0||process.argv.length!==2)throw Error('update_worker_root_no_arguments_required');
  const settings=await privateJson('/etc/domyro-updater/worker.json');
  if(settings.schemaVersion!==1||settings.managedIntegrations?.length!==0)
    throw Error('update_worker_core_only_required');
  const authorize=async()=>{
    const gate=assessOwnerInstallationGate(await privateJson('/etc/domyro-updater/installation-readiness.json'));
    if(!gate.ready)throw Error('installation_gate_closed');
    const fresh=await privateJson('/etc/domyro-updater/publisher.json');
    validatePublisherTrustPolicy({policy:fresh});
    if(JSON.stringify(fresh)!==JSON.stringify(policy))throw Error('publisher_changed_restart_worker');
  };
  const policy=await privateJson('/etc/domyro-updater/publisher.json');
  const host=createNativeUpdateHost({...settings.layout,policy,authorize,download:selectNativeReleasePackage});
  const job=await createNativeUpdateJob({root:'/var/lib/domyro-updater/state',host});
  // Recovery does not require the release gate to remain open: restoring a
  // previously installed release must still work if publishing is disabled.
  await job.recover();
  const socket='/run/domyro-updater/control.sock';
  try {
    const s=await lstat(socket);
    if(!s.isSocket()||s.uid!==0)throw Error('update_worker_socket_unsafe');
    await unlink(socket);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const server=createUpdateWorkerServer({job,authorize:host.authorize,currentVersion:host.currentVersion});
  server.on('error',()=>{process.exitCode=1;});
  server.listen(socket,async()=>{await chmod(socket,0o660);});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
}
main().catch(()=>{console.error('Domyro update worker could not start; inspect configuration and recovery journal.');process.exitCode=1;});
