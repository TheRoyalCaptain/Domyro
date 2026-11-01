// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scratch-only restoration of authenticated configuration fixtures.
 * Only a NEW disposable directory, never live service paths.
 * A missing RESTORE_VERIFIED.json always means INCOMPLETE.
 */
import {createHash} from 'node:crypto';
import {constants as fs} from 'node:fs';
import {lstat,realpath,mkdir,open,readFile,readdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {withVerifiedPrivateBackup} from './streamed-backup.mjs';
const MAGIC=Buffer.from('DOMCONF1\n','ascii');
const ROLES=new Set(['domyro_core','mosquitto','zigbee2mqtt']);
const FILE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const TARGET=/^domyro_restore_test_[a-z0-9]{6,40}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_PAYLOAD=8*1024*1024;
async function privateParent(directory){
  if(typeof directory!=='string'||!directory)throw new TypeError('scratch_parent_required');
  const dir=resolve(directory),st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||await realpath(dir)!==dir)throw new Error('scratch_parent_must_be_private');
  return dir;
}
async function syncDir(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
async function writeExclusive(path,bytes){const fd=await open(path,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}}
function parseEnvelope(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_PAYLOAD||!bytes.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('restore_config_format_invalid');
  let doc;
  try{doc=JSON.parse(bytes.subarray(MAGIC.length).toString('utf8'));}catch{throw new Error('restore_config_format_invalid');}
  if(doc?.schemaVersion!==1||doc.format!=='domyro-selected-config-fixture'||!Array.isArray(doc.files)||doc.files.length<1||doc.files.length>12)throw new Error('restore_config_manifest_invalid');
  const seen=new Set(),files=[];
  try{
    for(const row of doc.files){
      if(!row||!ROLES.has(row.role)||typeof row.name!=='string'||!FILE.test(row.name)||row.name==='.'||row.name==='..'||!SHA.test(row.sha256??'')||
         typeof row.base64!=='string'||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>512*1024)throw new Error('restore_config_entry_invalid');
      const key=row.role+'/'+row.name;
      if(seen.has(key))throw new Error('restore_config_duplicate_entry');
      seen.add(key);
      if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.base64))throw new Error('restore_config_base64_invalid');
      const data=Buffer.from(row.base64,'base64');
      if(data.length!==row.bytes||data.toString('base64')!==row.base64||createHash('sha256').update(data).digest('hex')!==row.sha256){
        data.fill(0);throw new Error('restore_config_integrity_failed');
      }
      files.push({role:row.role,name:row.name,sha256:row.sha256,data});
    }
    return files;
  }catch(e){for(const f of files)f.data.fill(0);throw e;}
}
async function checkFile(path,expected){
  const fd=await open(path,fs.O_RDONLY|fs.O_NOFOLLOW);
  try{
    const st=await fd.stat();
    if(!st.isFile()||(st.mode&0o077)||st.size!==expected.data.length)throw new Error('restore_written_file_invalid');
    const got=await fd.readFile();
    const okay=got.equals(expected.data);
    got.fill(0);
    if(!okay)throw new Error('restore_written_file_changed');
  }finally{await fd.close();}
}
/**
 * beforeWrite is ONLY a failure-injection test hook, not a production API.
 * Entire encrypted backup is authenticated before target directory is created.
 */
export async function restoreConfigFixtureToScratch({backupDirectory,backupName,password,scratchParent,targetName,beforeWrite=async()=>{}}){
  if(typeof targetName!=='string'||!TARGET.test(targetName))throw new Error('restore_target_must_be_disposable_test_directory');
  if(typeof beforeWrite!=='function')throw new TypeError('invalid_restore_hook');
  const parent=await privateParent(scratchParent);
  return withVerifiedPrivateBackup({
    directory:backupDirectory,name:backupName,password,maxPlainBytes:MAX_PAYLOAD,
    callback:async({archivePath})=>{
      const bytes=await readFile(archivePath);
      let files;
      try{files=parseEnvelope(bytes);}finally{bytes.fill(0);}
      const destination=join(parent,targetName);
      let created=false;
      try{
        // Exclusive mkdir refuses even an empty pre-existing target.
        await mkdir(destination,{mode:0o700});created=true;
        const roles=[...new Set(files.map(f=>f.role))];
        for(const role of roles)await mkdir(join(destination,role),{mode:0o700});
        for(const [i,file] of files.entries()){
          await beforeWrite(i,{role:file.role,name:file.name});
          const path=join(destination,file.role,file.name);
          await writeExclusive(path,file.data);
          await checkFile(path,file);
        }
        for(const role of roles)await syncDir(join(destination,role));
        const marker=Buffer.from(JSON.stringify({schemaVersion:1,developmentOnly:true,complete:true,
          files:files.map(({role,name,sha256})=>({role,name,sha256}))})+'\n');
        // A crash before this marker means the restore remains incomplete.
        await writeExclusive(join(destination,'RESTORE_VERIFIED.json'),marker);
        await syncDir(destination);await syncDir(parent);
        const checked=await inspectScratchConfigRestore({scratchParent:parent,targetName});
        if(!checked.scratchFilesMatchManifest)throw new Error('scratch_restore_verify_failed');
        return Object.freeze({scratchRestored:true,productionRestoreApproved:false,targetName,
          fileCount:files.length,componentRoles:Object.freeze(roles)});
      }catch(e){
        if(created)await rm(destination,{recursive:true,force:true});
        throw e;
      }finally{for(const file of files)file.data.fill(0);}
    },
  });
}


/**
 * Independent-on-disk scratch file verification.
 * The marker is NOT signed, and is NOT proof of production disaster recovery.
 * A partial or modified scratch directory is never accepted.
 */
export async function inspectScratchConfigRestore({scratchParent,targetName}) {
  if(typeof targetName!=='string'||!TARGET.test(targetName))throw new Error('restore_target_must_be_disposable_test_directory');
  const parent=await privateParent(scratchParent),root=join(parent,targetName);
  const st=await lstat(root);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077))throw new Error('scratch_restore_directory_untrusted');
  const markerPath=join(root,'RESTORE_VERIFIED.json');
  const markerFd=await open(markerPath,fs.O_RDONLY|fs.O_NOFOLLOW);
  let doc;
  try{
    const info=await markerFd.stat();
    if(!info.isFile()||(info.mode&0o077)||info.size<20||info.size>8192)throw new Error('scratch_restore_marker_invalid');
    try{doc=JSON.parse(await markerFd.readFile('utf8'));}catch{throw new Error('scratch_restore_marker_invalid');}
  }finally{await markerFd.close();}
  if(doc?.schemaVersion!==1||doc.developmentOnly!==true||doc.complete!==true||
     !Array.isArray(doc.files)||doc.files.length<1||doc.files.length>12)throw new Error('scratch_restore_marker_invalid');
  const used=new Set(),roles=new Set();
  for(const item of doc.files){
    if(!item||!ROLES.has(item.role)||typeof item.name!=='string'||!FILE.test(item.name)||
       item.name==='.'||item.name==='..'||!SHA.test(item.sha256??''))throw new Error('scratch_restore_marker_invalid');
    const key=item.role+'/'+item.name;
    if(used.has(key))throw new Error('scratch_restore_marker_duplicate');
    used.add(key);roles.add(item.role);
  }
  const rootEntries=await readdir(root);
  const allowed=new Set([...roles,'RESTORE_VERIFIED.json']);
  if(rootEntries.length!==allowed.size||rootEntries.some(x=>!allowed.has(x)))throw new Error('scratch_restore_extra_files');
  for(const role of roles){
    const folder=join(root,role),s=await lstat(folder);
    if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077))throw new Error('scratch_restore_role_untrusted');
    const actual=await readdir(folder);
    const expected=doc.files.filter(x=>x.role===role);
    if(actual.length!==expected.length||actual.some(x=>!expected.some(y=>y.name===x)))throw new Error('scratch_restore_extra_files');
    for(const item of expected){
      const path=join(folder,item.name),before=await lstat(path);
      if(!before.isFile()||before.isSymbolicLink()||(before.mode&0o077)||before.size<1||before.size>512*1024)throw new Error('scratch_restore_file_untrusted');
      const fd=await open(path,fs.O_RDONLY|fs.O_NOFOLLOW);
      try{
        const after=await fd.stat();
        if(!after.isFile()||after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size||(after.mode&0o077))throw new Error('scratch_restore_file_changed');
        const bytes=await fd.readFile();
        const hashed=createHash('sha256').update(bytes).digest('hex');
        bytes.fill(0);
        if(hashed!==item.sha256)throw new Error('scratch_restore_file_digest_mismatch');
      }finally{await fd.close();}
    }
  }
  return Object.freeze({scratchFilesMatchManifest:true,productionRestoreApproved:false,
    fileCount:doc.files.length,components:Object.freeze([...roles])});
}
