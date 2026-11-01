// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development-only streaming authenticated backup format DOMYROS2.
 * No scheduler, external storage, key management or production recovery.
 * Restore callback receives plaintext ONLY AFTER AES-GCM verification.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash, scrypt as scryptCallback } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, link, unlink, lstat, realpath } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCallback);
const MAGIC=Buffer.from('DOMYROS2','ascii');
const LIMIT=2*1024*1024*1024;
const HEADER_LIMIT=2048;
const KDF={N:32768,r:8,p:1,maxmem:128*1024*1024};
const NAME=/^[a-z0-9][a-z0-9_-]{1,90}\.domyrobackup$/;
function checkName(name) {
  if(typeof name!=='string'||!NAME.test(name)||basename(name)!==name)throw new TypeError('unsafe_backup_filename');
}
function checkPassword(pass) {
  if(typeof pass!=='string'||pass.length<12||pass.length>1024)throw new TypeError('backup_password_policy');
}
function checkLimit(value) {
  if(!Number.isSafeInteger(value)||value<1||value>LIMIT)throw new TypeError('invalid_backup_size_limit');
}
async function privateDir(directory) {
  if(typeof directory!=='string'||!directory)throw new TypeError('backup_directory_required');
  const dir=resolve(directory),st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||await realpath(dir)!==dir)throw new Error('backup_directory_must_be_private');
  return dir;
}
async function writeAll(fd,buffer) {
  let offset=0;
  while(offset<buffer.length) {
    const {bytesWritten}=await fd.write(buffer,offset,buffer.length-offset);
    if(bytesWritten<1)throw new Error('backup_write_failed');
    offset+=bytesWritten;
  }
}
async function readExact(fd,n,pos) {
  const b=Buffer.alloc(n);
  let offset=0;
  while(offset<n) {
    const {bytesRead}=await fd.read(b,offset,n-offset,pos+offset);
    if(!bytesRead)throw new Error('backup_v2_truncated');
    offset+=bytesRead;
  }
  return b;
}
async function unlinkIfExists(path) {
  try {await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}
}
async function syncDir(dir) {
  const fd=await open(dir,'r');
  try{await fd.sync();}finally{await fd.close();}
}
/** Stream ciphertext into a private temporary file and publish only after producer success. */
export async function encryptStreamToPrivateFile({source,directory,name,password,maxPlainBytes=LIMIT,beforePublish=async()=>{}}) {
  checkName(name);checkPassword(password);checkLimit(maxPlainBytes);
  if(!source||typeof source[Symbol.asyncIterator]!=='function'||typeof beforePublish!=='function')throw new TypeError('invalid_backup_source');
  const dir=await privateDir(directory),salt=randomBytes(32),iv=randomBytes(12);
  const header=Buffer.from(JSON.stringify({schemaVersion:2,cipher:'aes-256-gcm',kdf:'scrypt',
    N:KDF.N,r:KDF.r,p:KDF.p,salt:salt.toString('hex'),nonce:iv.toString('hex'),createdAt:new Date().toISOString()}));
  if(header.length>HEADER_LIMIT)throw new Error('backup_v2_header_too_large');
  const count=Buffer.alloc(4);count.writeUInt32BE(header.length);
  const aad=Buffer.concat([MAGIC,count,header]);
  const key=await scrypt(password,salt,32,KDF),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const temp=join(dir,'.domyro-v2-staging-'+randomBytes(16).toString('hex'));
  let fd,total=0;
  const digest=createHash('sha256');
  try {
    fd=await open(temp,'wx',0o600);
    await writeAll(fd,aad);
    for await(const chunk of source) {
      if(!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))throw new TypeError('backup_stream_chunk_invalid');
      if(chunk.length>maxPlainBytes-total)throw new Error('backup_stream_limit_exceeded');
      total+=chunk.length;
      digest.update(chunk);
      await writeAll(fd,cipher.update(chunk));
    }
    await writeAll(fd,cipher.final());
    await writeAll(fd,cipher.getAuthTag());
    // Check exporter exit status before classifying its empty stdout.
    // Neither condition can publish a backup file.
    await beforePublish();
    if(total<8)throw new Error('backup_stream_empty');
    await fd.sync();await fd.close();fd=null;
    await link(temp,join(dir,name)); // EEXIST, never replace
    await syncDir(dir);
    return Object.freeze({filename:name,plaintextBytes:total,sha256:digest.digest('hex'),format:'DOMYROS2'});
  } finally {
    key.fill(0);
    if(fd)await fd.close();
    await unlinkIfExists(temp);
  }
}
/** Full authentication is verified before callback may inspect or restore the temp file. */
export async function withVerifiedPrivateBackup({directory,name,password,callback,maxPlainBytes=LIMIT}) {
  checkName(name);checkPassword(password);checkLimit(maxPlainBytes);
  if(typeof callback!=='function')throw new TypeError('backup_callback_required');
  const dir=await privateDir(directory),source=join(dir,name);
  const st=await lstat(source);
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw new Error('backup_file_untrusted');
  const fd=await open(source,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  const tmp=join(dir,'.domyro-v2-verified-'+randomBytes(16).toString('hex'));
  let out;
  try {
    const after=await fd.stat();
    if(!after.isFile()||after.ino!==st.ino||after.dev!==st.dev||after.size!==st.size||(after.mode&0o077))throw new Error('backup_file_changed');
    if(after.size<12+16+32)throw new Error('backup_v2_truncated');
    const prefix=await readExact(fd,12,0);
    if(!prefix.subarray(0,8).equals(MAGIC))throw new Error('backup_v2_magic_invalid');
    const n=prefix.readUInt32BE(8);
    if(!n||n>HEADER_LIMIT||after.size<12+n+16)throw new Error('backup_v2_header_invalid');
    const raw=await readExact(fd,n,12);
    let h;
    try {h=JSON.parse(raw.toString('utf8'));}
    catch{throw new Error('backup_v2_header_invalid');}
    if(!h||h.schemaVersion!==2||h.cipher!=='aes-256-gcm'||h.kdf!=='scrypt'||h.N!==KDF.N||h.r!==KDF.r||h.p!==KDF.p||
      !/^[a-f0-9]{64}$/.test(h.salt??'')||!/^[a-f0-9]{24}$/.test(h.nonce??'')||
      typeof h.createdAt!=='string'||!Number.isFinite(Date.parse(h.createdAt)))throw new Error('backup_v2_header_invalid');
    const tag=await readExact(fd,16,after.size-16);
    const key=await scrypt(password,Buffer.from(h.salt,'hex'),32,KDF);
    let total=0;
    const hash=createHash('sha256');
    try {
      const decoder=createDecipheriv('aes-256-gcm',key,Buffer.from(h.nonce,'hex'));
      decoder.setAAD(Buffer.concat([prefix,raw]));decoder.setAuthTag(tag);
      out=await open(tmp,'wx',0o600);
      let offset=12+n,limit=after.size-16;
      while(offset<limit) {
        const size=Math.min(65536,limit-offset),encrypted=await readExact(fd,size,offset);
        offset+=size;
        const plain=decoder.update(encrypted);
        if(plain.length>maxPlainBytes-total)throw new Error('backup_stream_limit_exceeded');
        total+=plain.length;hash.update(plain);
        await writeAll(out,plain);
      }
      let rest;
      try{rest=decoder.final();}catch{throw new Error('backup_authentication_failed');}
      if(rest.length>maxPlainBytes-total)throw new Error('backup_stream_limit_exceeded');
      total+=rest.length;hash.update(rest);
      await writeAll(out,rest);
      if(total<8)throw new Error('backup_stream_empty');
      await out.sync();await out.close();out=null;
    }finally{key.fill(0);}
    return await callback(Object.freeze({archivePath:tmp,plaintextBytes:total,sha256:hash.digest('hex')}));
  }finally {
    if(out)await out.close();
    await fd.close();
    await unlinkIfExists(tmp);
  }
}
