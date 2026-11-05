#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Offline, signed first-install entry point. No unpublished key or test
// authorization is generated here. An interrupted install is never overwritten.
import {readFile,lstat,mkdir,writeFile,chmod,open} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePublisherTrustPolicy} from '../src/lifecycle/publisher-trust-policy.mjs';
import {inspectOfflineNativeSourceRelease} from '../src/lifecycle/native-release-verifier.mjs';
import {prepareVerifiedNativeSource} from '../src/lifecycle/prepare-native-source.mjs';
import {assessOwnerInstallationGate} from './check-installation-gate.mjs';

const ROOT='/var/lib/domyro-first-install';
export function parseFirstInstallArgs(args) {
  if(args[0]!=='--install')throw Error('explicit_install_required');
  const values={};
  for(const arg of args.slice(1)) {
    const m=/^--(directory|publisher-policy|readiness)=(\/[^\0\r\n]+)$/.exec(arg);
    if(!m||values[m[1]])throw Error('first_install_argument_invalid');
    values[m[1]]=resolve(m[2]);
  }
  if(Object.keys(values).length!==3)throw Error('first_install_arguments_missing');
  return values;
}
async function privateJson(path) {
  const s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||
     (s.mode&0o022)!==0||s.size>65536)throw Error('first_install_policy_unsafe');
  return JSON.parse(await readFile(path,'utf8'));
}
async function exclusivePrivateFile(path,value) {
  const fd=await open(path,'wx',0o600);
  try {await fd.writeFile(value);await fd.sync();}finally{await fd.close();}
}
async function syncDir(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
export async function verifyFirstInstallRelease({directory,policy,readiness,architecture}) {
  if(!assessOwnerInstallationGate(readiness).ready)throw Error('installation_gate_closed');
  validatePublisherTrustPolicy({policy});
  // First installation has no database. The signed manifest still has to
  // target the schema supported by this installer; migrations happen only
  // against the exclusively created empty Domyro database.
  const verified=await inspectOfflineNativeSourceRelease({directory,architecture,databaseSchema:3,
    trustedPublicKeyPem:policy.publicKeyPem,expectedPublicKeySha256:policy.publisherFingerprintSha256});
  return verified;
}
async function main() {
  const options=parseFirstInstallArgs(process.argv.slice(2));
  if(process.getuid?.()!==0)throw Error('first_install_root_required');
  const os=await readFile('/etc/os-release','utf8');
  if(!/^ID=ubuntu$/m.test(os)||!/^VERSION_ID="24\.04"$/m.test(os))throw Error('native_ubuntu_24_04_required');
  await lstat('/run/systemd/system');
  try {await lstat('/.dockerenv');throw Error('containers_not_supported');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const policy=await privateJson(options['publisher-policy']);
  const readiness=await privateJson(options.readiness);
  const architecture={x64:'amd64',arm64:'arm64'}[process.arch];
  const verified=await verifyFirstInstallRelease({directory:options.directory,policy,readiness,architecture});
  for(const path of ['/opt/domyro','/etc/domyro','/etc/domyro-updater',
    '/usr/lib/domyro-updater','/var/lib/domyro-updater','/etc/systemd/system/domyro.service',
    '/etc/systemd/system/domyro-updater.service']) {
    try{await lstat(path);throw Error('existing_install_or_interrupted_attempt');}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const account=spawnSync('getent',['passwd','domyro'],{stdio:'ignore'});
  if(account.status!==2)throw Error('existing_install_or_interrupted_attempt');
  // No application, account, service or database changes before verification.
  // Exclusive mkdir is also the install lock and durable interrupted-install
  // marker. It is deliberately retained after both success and failure.
  await mkdir(ROOT,{mode:0o711});await chmod(ROOT,0o711);
  await syncDir('/var/lib');
  await exclusivePrivateFile(ROOT+'/receipt.json',JSON.stringify({schemaVersion:1,
    version:verified.version,manifestSha256:verified.manifestSha256,
    publisherFingerprint:verified.publisherFingerprint,startedAt:new Date().toISOString()})+'\n');
  await mkdir(ROOT+'/authority',{mode:0o700});
  await exclusivePrivateFile(ROOT+'/authority/publisher.json',JSON.stringify(policy)+'\n');
  await exclusivePrivateFile(ROOT+'/authority/installation-readiness.json',JSON.stringify(readiness)+'\n');
  await syncDir(ROOT+'/authority');await syncDir(ROOT);
  const staged=await prepareVerifiedNativeSource({directory:options.directory,
    stageRoot:ROOT+'/source',currentVersion:'0.0.0',architecture,databaseSchema:3,
    trustedPublicKeyPem:policy.publicKeyPem,expectedPublicKeySha256:policy.publisherFingerprintSha256});
  if(staged.signedManifestSha256!==verified.manifestSha256)throw Error('first_install_package_changed');
  // Provision PostgreSQL only when no native server unit exists. An existing
  // stopped server is never silently started or replaced. Ubuntu apt metadata
  // authenticates the OS packages; no third-party package repository is added.
  const pgUnit=spawnSync('systemctl',['show','--value','-p','LoadState','postgresql.service'],{encoding:'utf8'});
  const run=(file,args)=>{const r=spawnSync(file,args,{stdio:'inherit',env:{...process.env,DEBIAN_FRONTEND: 'noninteractive'}});
    if(r.status!==0)throw Error('native_prerequisite_failed');};
  if(pgUnit.stdout?.trim()==='not-found') {
    run('apt-get',['update','-qq']);
    run('apt-get',['install','-y','-qq','postgresql','postgresql-client']);
    run('systemctl',['enable','--now','postgresql.service']);
  } else if(pgUnit.stdout?.trim()!=='loaded'||
    spawnSync('systemctl',['is-active','--quiet','postgresql.service']).status!==0) {
    throw Error('existing_postgres_not_active');
  }
  // Execute only the installer contained in the verified source bundle.
  const script=staged.stageDirectory+'/scripts/native-core-install.sh';
  const stat=await lstat(script);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)
    throw Error('first_install_signed_entrypoint_missing');
  await new Promise((resolve,reject)=>{
    const child=spawn('/bin/bash',[script,'--install-verified-core'],{
      cwd:staged.stageDirectory,stdio:'inherit',env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('native_first_install_incomplete')));
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{
  const safe=['explicit_install_required','first_install_argument_invalid','first_install_arguments_missing',
    'existing_install_or_interrupted_attempt','existing_postgres_not_active','native_prerequisite_failed',
    'first_install_root_required','native_ubuntu_24_04_required','containers_not_supported','installation_gate_closed',
    'first_install_package_changed','native_first_install_incomplete'];
  console.error('Domyro installation refused or interrupted: '+(safe.includes(error.message)?error.message:
    error.code==='EEXIST'?'existing_install_or_interrupted_attempt':'verification_or_preflight_failed'));
  process.exitCode=1;
});
