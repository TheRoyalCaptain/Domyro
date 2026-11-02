// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderNativeSystemdDraft} from '../src/lifecycle/native-install-plan.mjs';

const exec=promisify(execFile);
test('Ubuntu systemd actually parses hardened Domyro unit draft without enabling it',{
  skip:process.env.DOMYRO_SYSTEMD_VERIFY!=='1',
},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'domyro-unit-verify-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const unit=join(directory,'domyro.service');
  const text=renderNativeSystemdDraft({port:8844});
  // Ubuntu CI obtains Node from actions/setup-node. systemd-analyze verifies
  // the drafted directives against the actual *test* executable; the real
  // package must later provide /usr/bin/node as specified by the unit.
  assert.match(text,/ExecStart=\/usr\/bin\/node/);
  const testUnit = text.replace('ExecStart=/usr/bin/node ', 'ExecStart='+process.execPath+' ');
  await writeFile(unit,testUnit,{mode:0o600,flag:'wx'});
  const version=await exec('systemd-analyze',['--version'],{timeout:5000});
  assert.match(version.stdout,/systemd [0-9]+/);
  // Parses only. No systemctl, daemon-reload, service creation or host writes.
  const result=await exec('systemd-analyze',['verify',unit],{timeout:10000});
  assert.equal(result.stdout.trim(),'');
  assert.match(text,/User=domyro/);
  assert.match(text,/NoNewPrivileges=yes/);
  assert.match(text,/ProtectSystem=strict/);
  assert.match(text,/CapabilityBoundingSet=/);
  assert.match(text,/AmbientCapabilities=/);
  assert.match(text,/ProtectKernelTunables=yes/);
  assert.match(text,/ProtectKernelModules=yes/);
  assert.match(text,/ProtectControlGroups=yes/);
  assert.match(text,/RestrictSUIDSGID=yes/);
  assert.match(text,/LockPersonality=yes/);
  assert.match(text,/UMask=0077/);
  assert.match(text,/DOMYRO_HOST=127\.0\.0\.1/);
});
