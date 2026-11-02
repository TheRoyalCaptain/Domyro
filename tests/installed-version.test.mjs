// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INSTALLED_VERSION,validateInstalledPackage } from '../src/lifecycle/installed-version.mjs';
import { getDevelopmentUpdateStatus } from '../src/lifecycle/update-center.mjs';
import { createManualReleaseChecker } from '../src/lifecycle/manual-release-check.mjs';
import { createDomyroServer } from '../src/server.mjs';
import { once } from 'node:events';

test('public HTTP status, update center and manual check use the same installed version',async t=>{
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.equal(INSTALLED_VERSION,pkg.version);
  assert.equal(getDevelopmentUpdateStatus().currentVersion,INSTALLED_VERSION);
  const discover=async({currentVersion})=>{
    assert.equal(currentVersion,INSTALLED_VERSION);
    return {state:'no_official_release_published',latestVersion:null,currentVersion};
  };
  const checked=await createManualReleaseChecker({discover}).check();
  assert.equal(checked.currentVersion,INSTALLED_VERSION);
  assert.equal(checked.installAllowed,false);
  const server=createDomyroServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/public/status');
  assert.equal(response.status,200);
  assert.equal((await response.json()).version,INSTALLED_VERSION);
});
test('invalid package metadata cannot be used as an update baseline',()=>{
  for(const pkg of [
    null,[],{}, {name:'other',version:'1.0.0'},
    {name:'domyro',version:123},{name:'domyro',version:'latest'},
    {name:'domyro',version:'1.2.3; rm -rf /'},
    {name:'domyro',version:'v1.2.3'},
    {name:'domyro',version:'9'.repeat(81)},
  ])assert.throws(()=>validateInstalledPackage(pkg),/installed_version_manifest_invalid/);
  assert.equal(validateInstalledPackage({name:'domyro',version:'1.2.3'}),'1.2.3');
});
