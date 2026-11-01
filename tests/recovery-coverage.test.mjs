// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_COMPONENTS, assessRecoveryCoverage, currentDevelopmentRecoveryCoverage } from '../src/lifecycle/recovery-coverage.mjs';

const sample = () => RECOVERY_COMPONENTS.map(({id, mandatory}) => ({
  id, ownership:mandatory?'managed':'not-configured',
  snapshot:mandatory?'captured':'not-applicable',
  decryptedAndChecked:mandatory, restoredInScratch:mandatory,
  coordinated:mandatory, includesSecrets:mandatory,
}));
test('default current project recovery coverage stays blocked and never approves production', () => {
  const result = currentDevelopmentRecoveryCoverage();
  assert.equal(result.contractCoverageComplete, false);
  assert.equal(result.productionRestoreApproved, false);
  assert.ok(result.blockers.some(x=>x.component==='postgresql'));
  assert.ok(result.blockers.some(x=>x.component==='auth_and_recovery_keys'));
});
test('complete planning flags never authorize actual production recovery', () => {
  const rows = sample();
  const result = assessRecoveryCoverage(rows);
  assert.equal(result.contractCoverageComplete, true);
  assert.equal(result.productionRestoreApproved, false);
});
test('external service cannot count as safe unless independent recovery evidence exists', () => {
  const rows = sample();
  const external = rows.find(x=>x.id==='zigbee2mqtt');
  external.ownership='external';
  external.snapshot='externally-verified';
  external.restoredInScratch=false;
  external.coordinated=true;
  assert.equal(assessRecoveryCoverage(rows).contractCoverageComplete,false);
  external.restoredInScratch=true;
  assert.equal(assessRecoveryCoverage(rows).contractCoverageComplete,true);
  const fabric = rows.find(x=>x.id==='matter_fabrics');
  fabric.ownership='managed'; fabric.snapshot='captured';
  fabric.decryptedAndChecked=true;fabric.restoredInScratch=true;
  fabric.coordinated=true;fabric.includesSecrets=false;
  assert.ok(assessRecoveryCoverage(rows).blockers.some(x=>x.component==='matter_fabrics'&&x.reason==='component_secrets_uncovered'));
});
test('inconsistent, duplicated and missing inventory entries are rejected',()=>{
  const rows=sample();
  assert.throws(()=>assessRecoveryCoverage(rows.slice(1)),/invalid_recovery_inventory/);
  rows[0].id=rows[1].id;
  assert.throws(()=>assessRecoveryCoverage(rows),/invalid_recovery_component/);
  rows[0].id='postgresql';
  rows[0].restoredInScratch='yes';
  assert.throws(()=>assessRecoveryCoverage(rows),/invalid_recovery_component/);
});
