// SPDX-License-Identifier: AGPL-3.0-only
// Durable update orchestration. Privileged host operations are supplied by the
// native worker, never by an HTTP request or a downloaded package.
import {open, readFile, rename, unlink, lstat, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {compareVersions} from './release.mjs';

const PHASES = new Set(['preparing','stopping','backing_up','activating','checking','committed','recovering','recovered']);
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function syncDirectory(root) {
  const fd=await open(root,'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function safeRoot(root) {
  const stat=await lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
     stat.uid!==process.getuid()||await realpath(root)!==root) throw Error('update_state_directory_unsafe');
}
async function readRecord(path) {
  let stat;
  try { stat=await lstat(path); } catch(e) { if(e.code==='ENOENT')return null;throw e; }
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8192||
     stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('update_journal_unsafe');
  const record=JSON.parse(await readFile(path,'utf8'));
  if(record.schemaVersion!==1||!/^[-0-9a-f]{36}$/.test(record.id)||
     !VERSION.test(record.version)||!VERSION.test(record.previousVersion)||
     !PHASES.has(record.phase)||typeof record.backupVerified!=='boolean'||typeof record.restoreRequired!=='boolean')throw Error('update_journal_invalid');
  return record;
}

/** The worker holds an OS flock for its entire lifetime. There is only one
 * host adapter; the app process merely requests a version over a Unix socket.
 * A journal remains until commit or verified recovery. A crash never permits
 * a new update to overwrite unresolved recovery evidence. */
export async function createNativeUpdateJob({root,host}) {
  await safeRoot(root);
  for(const method of ['authorize','currentVersion','prepare','stop','backup','activate','healthy','restore','start','resume']) {
    if(typeof host?.[method]!=='function')throw TypeError('update_host_adapter_invalid');
  }
  const pending=join(root,'pending.json'),last=join(root,'last.json');
  let busy=false;
  async function persist(record,initial=false) {
    const target=initial?pending:join(root,record.id+'-'+randomUUID()+'.tmp');
    const fd=await open(target,'wx',0o600);
    try { await fd.writeFile(JSON.stringify(record)+'\n');await fd.sync(); } finally { await fd.close(); }
    if(!initial)await rename(target,pending);
    await syncDirectory(root);
  }
  async function finish(record) {
    await persist(record);
    await rename(pending,last);
    await syncDirectory(root);
  }
  async function recoverRecord(record) {
    // A durable commit is authoritative even if the last journal rename was
    // interrupted. Replaying recovery must not undo an acknowledged update.
    if(record.phase==='committed'||record.phase==='recovered') {
      await finish(record);await host.resume();return record;
    }
    const mayHaveActivated=record.restoreRequired;
    record={...record,phase:'recovering',updatedAt:new Date().toISOString()};
    await persist(record);
    await host.stop();
    if(mayHaveActivated) {
      if(!record.backupVerified)throw Error('update_recovery_backup_missing');
      await host.restore(record);
    }
    await host.start();
    if(!await host.healthy(record.previousVersion))throw Error('update_recovery_health_failed');
    record={...record,phase:'recovered',updatedAt:new Date().toISOString()};
    await finish(record);
    await host.resume();
    return record;
  }
  return Object.freeze({
    async status() {
      const record=await readRecord(pending)??await readRecord(last);
      return {busy,recoveryRequired:!!await readRecord(pending)&&!busy,
        job:record?{id:record.id,version:record.version,previousVersion:record.previousVersion,
          phase:record.phase,backupVerified:record.backupVerified,updatedAt:record.updatedAt}:null};
    },
    async recover() {
      if(busy)throw Error('update_busy');
      busy=true;
      try {
        const record=await readRecord(pending);
        if(record)return await recoverRecord(record);
        const previous=await readRecord(last);
        if(previous&&['committed','recovered'].includes(previous.phase))await host.resume();
        return null;
      }
      finally { busy=false; }
    },
    async install(version) {
      if(busy)throw Error('update_busy');
      if(typeof version!=='string'||version.length>80||!VERSION.test(version))throw Error('update_version_invalid');
      busy=true;
      let record=null,ownsJournal=false;
      try {
        if(await readRecord(pending))throw Error('update_recovery_required');
        await host.authorize();
        const previousVersion=await host.currentVersion();
        if(compareVersions(version,previousVersion)<=0)throw Error('update_not_newer');
        record={schemaVersion:1,id:randomUUID(),version,previousVersion,phase:'preparing',
          backupVerified:false,restoreRequired:false,updatedAt:new Date().toISOString()};
        await persist(record,true);ownsJournal=true;
        const phase=async value=>{record={...record,phase:value,updatedAt:new Date().toISOString()};await persist(record);};
        await host.prepare(record);
        await phase('stopping');
        await host.stop();
        await phase('backing_up');
        await host.backup(record);
        record={...record,backupVerified:true,restoreRequired:true};
        await phase('activating');
        await host.activate(record);
        await phase('checking');
        await host.start();
        if(!await host.healthy(version))throw Error('update_health_failed');
        record={...record,phase:'committed',updatedAt:new Date().toISOString()};
        await finish(record);
        await host.resume();
        return {version,state:'installed',backupVerified:true};
      } catch(error) {
        // Preparation failures never stop the currently running application.
        if(ownsJournal&&record?.phase==='preparing') {
          await unlink(pending);await syncDirectory(root);
        } else if(ownsJournal&&record&&record.phase!=='committed') {
          try { await recoverRecord(record); }
          catch { throw Error('update_failed_recovery_required',{cause:error}); }
        }
        throw error;
      } finally { busy=false; }
    },
  });
}
