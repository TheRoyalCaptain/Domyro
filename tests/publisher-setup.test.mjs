// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,lstat,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePublisher} from '../tools/setup-release-publisher.mjs';
import {validatePublisherTrustPolicy} from '../src/lifecycle/publisher-trust-policy.mjs';

test('publisher setup keeps matching key private and refuses key replacement or repository storage',async t=>{
 const root=await mkdtemp(join(tmpdir(),'domyro-publisher-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const target=join(root,'signer'),result=await preparePublisher(target);
 const privateKeyPem=await readFile(result.privateKey,'utf8');
 const policy=JSON.parse(await readFile(result.publicPolicy,'utf8'));
 assert.equal(validatePublisherTrustPolicy({policy,privateKeyPem}).signerMatchesPolicy,true);
 assert.equal((await lstat(result.privateKey)).mode&0o777,0o600);
 assert.equal((await lstat(target)).mode&0o777,0o700);
 assert.equal(JSON.stringify(result).includes(privateKeyPem),false);
 await assert.rejects(preparePublisher(target),/EEXIST/);
 assert.equal(await readFile(result.privateKey,'utf8'),privateKeyPem);
 const repo=join(root,'repo');await mkdir(repo);await mkdir(join(repo,'.git'));
 await assert.rejects(preparePublisher(join(repo,'secret')),/outside_git/);
 await assert.rejects(preparePublisher(join(repo,'secret'),{projectRoot:repo}),/outside_project/);
 const link=join(root,'linked');await symlink(target,link);
 await assert.rejects(preparePublisher(join(link,'secret')),/symlink_parent_refused/);
 assert.equal(JSON.parse(await readFile('config/release-publisher.json','utf8')).configured,false);
});
