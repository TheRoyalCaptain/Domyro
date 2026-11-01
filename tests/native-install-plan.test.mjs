// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNativeInstallPlan, renderNativeSystemdDraft } from '../src/lifecycle/native-install-plan.mjs';

const host={
  platform:'linux',osId:'ubuntu',versionId:'24.04',isLts:true,
  arch:'x64',cpuCount:4,ramBytes:8*1024**3,freeDiskBytes:40*1024**3,
  portAvailable:true,hasExistingDomyro:false,
};
const chosen={postgresql:'existing',mqtt:'existing',zigbee2mqtt:'defer',matter:'defer'};
const verified={postgresql:{verified:true},mqtt:{verified:true}};
test('eligible amd64 and arm64 Ubuntu environments are only PLANNABLE, never installed',()=>{
  for(const [arch,expected] of [['x64','amd64'],['arm64','arm64']]){
    const plan=assessNativeInstallPlan({host:{...host,arch},choices:chosen,existingServices:verified});
    assert.equal(plan.environmentCanBePlanned,true);
    assert.equal(plan.installationAllowed,false);
    assert.equal(plan.hostSideEffects,false);
    assert.equal(plan.arch,expected);
    assert.equal(plan.gate,'D-53');
    assert.equal(plan.requiresOwnerApprovalBeforeDeployment,true);
    assert.equal(plan.steps.every(x=>x.implemented===false),true);
  }
});
test('missing DB choice or unverified external services block planning',()=>{
  const missing=assessNativeInstallPlan({host,choices:{mqtt:'defer',zigbee2mqtt:'defer',matter:'defer'}});
  assert.ok(missing.blockers.includes('postgresql_choice_required'));
  assert.ok(missing.blockers.includes('postgresql_required_for_installation'));
  const db=assessNativeInstallPlan({host,choices:chosen,existingServices:{}});
  assert.ok(db.blockers.includes('postgresql_existing_connection_unverified'));
  assert.ok(db.blockers.includes('mqtt_existing_connection_unverified'));
});
test('managed services are not falsely presented as implemented or automatically installed',()=>{
  const choices={postgresql:'managed',mqtt:'managed',zigbee2mqtt:'defer',matter:'managed'};
  const result=assessNativeInstallPlan({host,choices});
  assert.equal(result.installationAllowed,false);
  assert.ok(result.blockers.includes('postgresql_managed_service_unimplemented'));
  assert.ok(result.blockers.includes('mqtt_managed_service_unimplemented'));
  assert.ok(result.blockers.includes('matter_managed_service_unimplemented'));
});
test('unsafe hosts, reserved ports and existing installation require separate update/recovery',()=>{
  const result=assessNativeInstallPlan({host:{...host,versionId:'26.04',hasExistingDomyro:true,portAvailable:false},
    choices:chosen,existingServices:verified,port:5432});
  assert.ok(result.blockers.includes('ubuntu_release_not_yet_tested'));
  assert.ok(result.blockers.includes('existing_install_requires_update_or_repair'));
  assert.ok(result.blockers.includes('port_in_use'));
  assert.ok(result.blockers.includes('invalid_or_reserved_port'));
});
test('draft systemd unit only produces text, binds to loopback, and never executes anything',()=>{
  const unit=renderNativeSystemdDraft({port:8844});
  assert.match(unit,/ExecStart=\/usr\/bin\/node/);
  assert.match(unit,/Environment=DOMYRO_HOST=127\.0\.0\.1/);
  assert.match(unit,/NoNewPrivileges=yes/);
  assert.match(unit,/ProtectSystem=strict/);
  assert.match(unit,/DRAFT \(NOT production\)/);
  assert.throws(()=>renderNativeSystemdDraft({port:22}),/invalid_native_systemd_port/);
  assert.throws(()=>renderNativeSystemdDraft({port:65536}),/invalid_native_systemd_port/);
});
