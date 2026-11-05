// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildSignedSourceRelease,writeSignedRelease} from '../tools/build-release.mjs';
import {parseFirstInstallArgs,verifyFirstInstallRelease,withFirstInstallSource} from '../scripts/install-native-source.mjs';

test('first install requires explicit operation and complete absolute inputs',()=>{
  assert.throws(()=>parseFirstInstallArgs([]),/explicit_install/);
  assert.throws(()=>parseFirstInstallArgs(['--install','--directory=relative']),/argument_invalid/);
  assert.throws(()=>parseFirstInstallArgs(['--install','--directory=/tmp','--directory=/tmp']),/argument_invalid/);
  assert.throws(()=>parseFirstInstallArgs(['--install','--force=true']),/argument_invalid/);
  assert.deepEqual(parseFirstInstallArgs(['--install','--directory=/tmp/release','--publisher-policy=/tmp/policy',
    '--readiness=/tmp/gate']),{directory:'/tmp/release','publisher-policy':'/tmp/policy',readiness:'/tmp/gate'});
});
test('first-install admission verifies independent publisher, package and readiness before host changes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'domyro-first-install-admission-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const pair=generateKeyPairSync('ed25519');
  const policy={schemaVersion:1,configured:true,releaseSource:'github.com/TheRoyalCaptain/Domyro/releases',
    publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),
    publisherFingerprintSha256:createHash('sha256').update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex')};
  const gate=JSON.parse(await readFile('config/installation-readiness.json','utf8'));
  const readiness={...gate,checks:Object.fromEntries(Object.keys(gate.checks).map(k=>[k,true])),
    readyForOwnerInstallation:true,ownerDeploymentConsentRecorded:true}; // Isolated fixture only.
  const signed=await buildSignedSourceRelease({projectRoot:process.cwd(),version:'0.1.1',channel:'stable',
    publishedAt:'2026-11-01T00:00:00Z',privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'})});
  const directory=join(root,'package');await writeSignedRelease(directory,signed);
  const args={directory,policy,readiness,architecture:'amd64'};
  const online={options:{version:'0.1.1'},policy,readiness,architecture:'amd64'};
  const files=new Map();
  for(const name of ['release-manifest.json','release-manifest.sig',
    'domyro-0.1.1-ubuntu-amd64.bundle.json','domyro-0.1.1-ubuntu-arm64.bundle.json'])
    files.set(name,await readFile(join(directory,name)));
  const {fetchVerifiedOfficialSourceRelease}=await import('../src/lifecycle/native-release-download.mjs');
  let downloadedPath,calls=0;
  const download=async inputs=>{calls++;return fetchVerifiedOfficialSourceRelease({...inputs,
    fetcher:async url=>new Response(files.get(new URL(url).pathname.split('/').pop()))});};
  await withFirstInstallSource(online,async path=>{
    downloadedPath=path;
    assert.equal((await verifyFirstInstallRelease({...args,directory:path})).signatureVerified,true);
  },{download});
  await assert.rejects(readFile(join(downloadedPath,'release-manifest.json')),/ENOENT/);
  await assert.rejects(withFirstInstallSource(online,async path=>{
    downloadedPath=path;throw Error('simulated_install_failure');
  },{download}),/simulated_install_failure/);
  await assert.rejects(readFile(join(downloadedPath,'release-manifest.json')),/ENOENT/);
  await assert.rejects(withFirstInstallSource({...online,readiness:gate},()=>assert.fail(),{download}),/installation_gate_closed/);
  assert.equal(calls,2);
  await withFirstInstallSource({...online,options:{directory}},path=>assert.equal(path,directory),
    {download:()=>assert.fail(),remove:()=>assert.fail()});

  assert.equal((await verifyFirstInstallRelease(args)).signatureVerified,true);
  await assert.rejects(verifyFirstInstallRelease({...args,readiness:gate}),/installation_gate_closed/);
  await assert.rejects(verifyFirstInstallRelease({...args,policy:{...policy,publisherFingerprintSha256:'a'.repeat(64)}}),/fingerprint_mismatch/);
  await writeFile(join(directory,'domyro-0.1.1-ubuntu-amd64.bundle.json'),'modified');
  await assert.rejects(verifyFirstInstallRelease(args),/hash_mismatch|size_mismatch/);
  assert.equal(JSON.parse(await readFile('config/installation-readiness.json','utf8')).readyForOwnerInstallation,false);
});

test('versioned first installation accepts only one source and an immutable version',()=>{
  const authority=['--publisher-policy=/etc/publisher.json','--readiness=/etc/readiness.json'];
  assert.equal(parseFirstInstallArgs(['--install',...authority,'--version=0.1.1']).version,'0.1.1');
  for(const extra of [['--version=latest'],['--version=../x'],['--version=0.1.1','--directory=/tmp/package'],
    ['--version=0.1.1','--version=0.1.2'],[]])
    assert.throws(()=>parseFirstInstallArgs(['--install',...authority,...extra]));
});
