// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {selectNativeReleasePackage} from '../src/lifecycle/native-release-cache.mjs';

test('offline package lookup never turns directory existence into signature trust',async t=>{
  const root=await mkdtemp(join(tmpdir(),'domyro-offline-package-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let downloads=0;
  const download=async()=>{downloads++;return {source:'network'};};
  assert.equal((await selectNativeReleasePackage({version:'0.1.1'},{root,download})).source,'network');
  await mkdir(join(root,'0.1.1'),{mode:0o700});
  const cached=await selectNativeReleasePackage({version:'0.1.1'},{root,download});
  assert.equal(cached.source,'operator_preloaded_signature_unverified');
  assert.equal(downloads,1);
  assert.equal(cached.signatureVerified,undefined);
  await chmod(join(root,'0.1.1'),0o777);
  await assert.rejects(selectNativeReleasePackage({version:'0.1.1'},{root,download}),/cache_unsafe/);
  await symlink(join(root,'0.1.1'),join(root,'0.1.2'));
  await assert.rejects(selectNativeReleasePackage({version:'0.1.2'},{root,download}),/cache_unsafe/);
  await assert.rejects(selectNativeReleasePackage({version:'../../secret'},{root,download}),/version_invalid/);
  assert.equal(downloads,1);
});
