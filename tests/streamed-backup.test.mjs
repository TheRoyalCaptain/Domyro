// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, open, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encryptStreamToPrivateFile, withVerifiedPrivateBackup } from '../src/lifecycle/streamed-backup.mjs';

const secret='unique-development-streaming-backup-passphrase';
async function sampleDir(t) {
  const dir=await mkdtemp(join(tmpdir(),'domyro-stream-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return dir;
}
test('streamed backup can encrypt and verify >20 MiB without buffering a single giant plaintext', async t=>{
  const dir=await sampleDir(t), digest=createHash('sha256');
  // Deterministic stream has 27 x 1 MiB chunks and a PostgreSQL-like prefix.
  const chunk=Buffer.concat([Buffer.from('PGDMP'),randomBytes(1024*1024-5)]);
  const data=Readable.from((async function*(){
    for(let i=0;i<27;i++){digest.update(chunk);yield chunk;}
  })());
  const result=await encryptStreamToPrivateFile({
    source:data,directory:dir,name:'large-fixture.domyrobackup',password:secret,
    maxPlainBytes:40*1024*1024,
  });
  assert.equal(result.plaintextBytes,27*1024*1024);
  assert.equal(result.sha256,digest.digest('hex'));
  const st=await lstat(join(dir,'large-fixture.domyrobackup'));
  assert.equal(st.mode&0o077,0);
  let outputHash;
  await withVerifiedPrivateBackup({
    directory:dir,name:'large-fixture.domyrobackup',password:secret,
    maxPlainBytes:40*1024*1024,
    callback:async ({archivePath,sha256,plaintextBytes})=>{
      assert.equal(plaintextBytes,27*1024*1024);
      const hash=createHash('sha256');
      for await(const data of createReadStream(archivePath))hash.update(data);
      outputHash=hash.digest('hex');
      assert.equal(outputHash,sha256);
    },
  });
  assert.equal(outputHash,result.sha256);
  assert.deepEqual((await readdir(dir)).filter(x=>x.startsWith('.domyro-')),[]);
  await assert.rejects(()=>encryptStreamToPrivateFile({
    source:Readable.from([Buffer.alloc(8)]),directory:dir,
    name:'large-fixture.domyrobackup',password:secret,
  }),/EEXIST/);
});

test('tampered ciphertext and incorrect password never invoke restore callback',async t=>{
  const dir=await sampleDir(t),name='tamper-test.domyrobackup';
  await encryptStreamToPrivateFile({
    source:Readable.from([Buffer.from('PGDMP valid test bytes')]),
    directory:dir,name,password:secret,
  });
  let invoked=0;
  const callback=()=>{invoked++;};
  await assert.rejects(()=>withVerifiedPrivateBackup({
    directory:dir,name,password:'incorrect-but-long-passphrase',callback,
  }),/backup_authentication_failed/);
  const f=await open(join(dir,name),'r+');
  try{
    const st=await f.stat(),original=Buffer.alloc(1);
    await f.read(original,0,1,st.size-20);
    await f.write(Buffer.from([original[0]^1]),0,1,st.size-20);
  }finally{await f.close();}
  await assert.rejects(()=>withVerifiedPrivateBackup({directory:dir,name,password:secret,callback}),/backup_authentication_failed/);
  assert.equal(invoked,0);
  assert.deepEqual((await readdir(dir)).filter(x=>x.startsWith('.domyro-')),[]);
});

test('failed stream producer or failed final validation never publishes a backup filename',async t=>{
  const dir=await sampleDir(t);
  const fails=Readable.from((async function*(){
    yield Buffer.from('PGDMP partial test');
    throw new Error('simulated_power_failure');
  })());
  await assert.rejects(()=>encryptStreamToPrivateFile({
    source:fails,directory:dir,name:'broken.domyrobackup',password:secret,
  }),/simulated_power_failure/);
  await assert.rejects(()=>encryptStreamToPrivateFile({
    source:Readable.from([Buffer.from('PGDMP failed exporter')]),
    directory:dir,name:'broken.domyrobackup',password:secret,
    beforePublish:async()=>{throw new Error('pg_dump_failed');},
  }),/pg_dump_failed/);
  assert.deepEqual(await readdir(dir),[]);
});

test('stream length ceiling and unsafe names fail closed',async t=>{
  const dir=await sampleDir(t);
  await assert.rejects(()=>encryptStreamToPrivateFile({
    source:Readable.from([Buffer.alloc(17)]),directory:dir,
    name:'too-large.domyrobackup',password:secret,maxPlainBytes:16,
  }),/backup_stream_limit_exceeded/);
  await assert.rejects(()=>encryptStreamToPrivateFile({
    source:Readable.from([Buffer.alloc(17)]),directory:dir,
    name:'..\/unsafe.domyrobackup',password:secret,
  }),/unsafe_backup_filename/);
  assert.deepEqual(await readdir(dir),[]);
});
