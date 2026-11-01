// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Streaming PostgreSQL 17 custom-format dump -> encrypted private file ->
 * authenticated private scratch -> EMPTY DISPOSABLE DB restoration.
 *
 * No production or owner-server commands, installer, scheduler, or access to
 * existing data. The archive can be large without buffering it in RAM.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Pool } from 'pg';
import { open } from 'node:fs/promises';
import { encryptStreamToPrivateFile, withVerifiedPrivateBackup } from './streamed-backup.mjs';
import { localDatabase, cliDatabaseArgs, RESTORE_PREFIX, selectedTool } from './postgres-snapshot.mjs';
import { loadMigrations, inspectMigrationState } from '../persistence/migrator.mjs';

const DEFAULT_TOOLS={
  dump:{executable:'pg_dump',prefix:[]},
  restore:{executable:'pg_restore',prefix:[]},
};
const PROCESS_TIMEOUT_MS=120_000;
function startTool(config,args,password) {
  const child=spawn(config.executable,[...config.prefix,...args],{
    shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,PGPASSWORD:password},
  });
  // Never collect/log raw stderr (possible secrets, unbounded output).
  child.stderr.resume();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},PROCESS_TIMEOUT_MS);
  const done=new Promise(resolve=>{
    child.on('close',code=>{clearTimeout(timer);resolve({code,timedOut});});
    child.on('error',()=>{clearTimeout(timer);resolve({code:-1,timedOut});});
  });
  return {child,done};
}
async function successful(result) {
  const state=await result.done;
  if(state.timedOut)throw new Error('postgres_tool_timeout');
  if(state.code!==0)throw new Error('postgres_tool_failed');
}

export async function dumpPostgresToStreamedBackup({
  sourceUrl,directory,name,password,maxPlainBytes=2*1024*1024*1024,
  tools=DEFAULT_TOOLS,
}) {
  const source=localDatabase(sourceUrl);
  const pgDump=selectedTool(tools.dump,DEFAULT_TOOLS.dump);
  const process=startTool(pgDump,[
    '--format=custom','--no-owner','--no-privileges','--schema=public',
    ...cliDatabaseArgs(source),
  ],source.password);
  process.child.stdin.end();
  try {
    const saved=await encryptStreamToPrivateFile({
      source:process.child.stdout,directory,name,password,maxPlainBytes,
      beforePublish:async()=>successful(process),
    });
    return Object.freeze({...saved,restorable:false});
  } catch(error) {
    process.child.kill('SIGKILL');
    await process.done;
    // Never leak connection details or raw external binary diagnostics.
    if(error?.code==='ENOENT')throw new Error('postgres_tool_not_available');
    throw error;
  }
}

async function restoredSchemaCheck(db) {
  const migrations=await loadMigrations();
  const c=await db.connect();
  try {
    const result=await inspectMigrationState(c,migrations);
    if(!result.ready)throw new Error('restored_schema_verification_failed');
    return result.schemaVersion;
  } finally{c.release();}
}

async function runRestoreIntoEmptyTarget(target,tools,archivePath) {
  const pool=new Pool({
    connectionString:target.connectionString,max:1,
    connectionTimeoutMillis:3000,statement_timeout:5000,
  });
  try {
    // No --clean, --create, DROP or destructive in-place restoration.
    const check=await pool.query([
      'SELECT count(*)::int AS n FROM pg_catalog.pg_class c',
      'JOIN pg_catalog.pg_namespace ns ON ns.oid=c.relnamespace',
      "WHERE ns.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')",
    ].join(' '));
    if(check.rows[0]?.n!==0)throw new Error('restore_target_not_empty');
    const pgRestore=selectedTool(tools.restore,DEFAULT_TOOLS.restore);
    const run=startTool(pgRestore,[
      '--exit-on-error','--single-transaction','--no-owner','--no-privileges',
      '--schema=public',...cliDatabaseArgs(target),
    ],target.password);
    run.child.stdout.resume();
    try {
      await pipeline(createReadStream(archivePath),run.child.stdin);
      await successful(run);
    } catch(error) {
      run.child.kill('SIGKILL');
      await run.done;
      if(error?.code==='ENOENT')throw new Error('postgres_tool_not_available');
      // Broken pipe is also an invalid archive/failed pg_restore, never a success.
      if(error?.code==='EPIPE')throw new Error('postgres_tool_failed');
      throw error;
    }
    return await restoredSchemaCheck(pool);
  }finally{await pool.end();}
}

/** No restore process is started until the entire encrypted file is authenticated. */
export async function restoreStreamedBackupToTestDatabase({
  directory,name,password,targetUrl,tools=DEFAULT_TOOLS,maxPlainBytes=2*1024*1024*1024,
}) {
  const target=localDatabase(targetUrl);
  if(!RESTORE_PREFIX.test(target.database))throw new Error('restore_target_must_be_disposable_test_database');
  return withVerifiedPrivateBackup({
    directory,name,password,maxPlainBytes,
    callback:async ({archivePath,plaintextBytes,sha256})=>{
      // A GCM-authenticated arbitrary file must not be accepted as a PG archive.
      const fd=await open(archivePath,'r');
      try {
        const magic=Buffer.alloc(5);
        const {bytesRead}=await fd.read(magic,0,5,0);
        if(bytesRead!==5||magic.toString('ascii')!=='PGDMP')throw new Error('not_a_postgresql_custom_archive');
      }finally{await fd.close();}
      const schemaVersion=await runRestoreIntoEmptyTarget(target,tools,archivePath);
      return Object.freeze({verifiedRestore:true,database:target.database,schemaVersion,
        archiveSha256:sha256,archiveBytes:plaintextBytes});
    },
  });
}
