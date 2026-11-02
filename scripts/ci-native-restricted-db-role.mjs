// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI-ONLY PostgreSQL role integration for a disposable Docker PostgreSQL 17
 * container on GitHub-hosted Ubuntu. NEVER run on real databases or hosts.
 *
 * The migrator/bootstrap uses the CI database owner, but the actual systemd
 * process must use a restricted non-DDL SQL principal. The role is destroyed
 * after the disposable database is dropped.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const TEST_ADMIN='postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test';
const actions=new Set(['create','verify','delete']);
const identifier=/^domyro_native_[0-9]+_[0-9]+$/;
const roleIdentifier=/^domyro_app_[0-9]+_[0-9]+$/;
function config(){
  const action=process.argv[2];
  const name=process.env.CI_DB_NAME;
  const role=process.env.CI_RUNTIME_ROLE;
  const password=process.env.CI_RUNTIME_PASSWORD;
  if(process.env.GITHUB_ACTIONS!=='true' ||
     process.env.RUNNER_ENVIRONMENT!=='github-hosted' ||
     process.env.DOMYRO_CI_SYSTEMD_ALLOWED!=='1' ||
     process.env.DOMYRO_CI_PG_ONBOARDING!=='1' ||
     process.env.RUNNER_OS!=='Linux' ||
     process.env.DOMYRO_TEST_DATABASE_URL!==TEST_ADMIN ||
     process.env.USER!=='runner' ||
     !actions.has(action) ||
     !identifier.test(name??'') || !roleIdentifier.test(role??'') ||
     !/^[A-Za-z0-9_-]{32,128}$/.test(password??'') ||
     process.argv.length!==3)throw new Error('ci_restricted_role_guard_failed');
  if(name!=='domyro_native_'+process.env.GITHUB_RUN_ID+'_'+process.env.GITHUB_RUN_ATTEMPT ||
     role!=='domyro_app_'+process.env.GITHUB_RUN_ID+'_'+process.env.GITHUB_RUN_ATTEMPT){
    throw new Error('ci_restricted_role_identity_mismatch');
  }
  const database=new URL(TEST_ADMIN);
  database.pathname='/'+name;
  const runtime=new URL(database.href);
  runtime.username=role;
  runtime.password=password;
  return {action,name,role,password,database:database.href,runtime:runtime.href};
}
async function main(){
  const cfg=config();
  const {Pool}=await import('pg');
  const admin=new Pool({connectionString:TEST_ADMIN,max:1});
  try{
    if(cfg.action==='create'){
      const target=new Pool({connectionString:cfg.database,max:1});
      try{
        // Strictly generated identifiers and URL-safe random password only;
        // NEVER pass arbitrary user values into SQL DDL.
        await admin.query('CREATE ROLE "'+cfg.role+'" LOGIN PASSWORD '+String.fromCharCode(39)+cfg.password+String.fromCharCode(39));
        await admin.query('GRANT CONNECT ON DATABASE "'+cfg.name+'" TO "'+cfg.role+'"');
        await target.query('GRANT USAGE ON SCHEMA public TO "'+cfg.role+'"');
        await target.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "'+cfg.role+'"');
        await target.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "'+cfg.role+'"');
      }finally{await target.end();}
    }else if(cfg.action==='verify'){
      const runtime=new Pool({connectionString:cfg.runtime,max:1});
      try{
        const p=await runtime.query("SELECT current_user AS name, has_database_privilege(current_user,current_database(),'CREATE') AS db_create, has_schema_privilege(current_user,'public','CREATE') AS schema_create, (SELECT COUNT(*)::integer FROM domyro_users) AS users");
        const got=p.rows[0];
        if(got.name!==cfg.role||got.db_create!==false||got.schema_create!==false||got.users!==1){
          throw new Error('ci_runtime_role_not_least_privileged');
        }
        let denied=false;
        try{await runtime.query('CREATE TABLE ci_prohibited_ddl_test (id int)');}
        catch(e){if(e.code==='42501')denied=true;else throw e;}
        if(!denied)throw new Error('ci_runtime_ddl_not_rejected');
      }finally{await runtime.end();}
    }else{
      // Database has already been DROPped in the caller's cleanup.
      await admin.query('DROP ROLE IF EXISTS "'+cfg.role+'"');
    }
    process.stdout.write('CI restricted PostgreSQL runtime principal '+cfg.action+' verified\n');
  }finally{await admin.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(e=>{
    console.error(e.message.startsWith('ci_')?'ci_restricted_database_role_failed': 'ci_restricted_database_role_failed');
    process.exitCode=1;
  });
}
