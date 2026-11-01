// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, chmod, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEncryptedConfigFixture, inspectEncryptedConfigFixture } from '../src/lifecycle/config-fixture-backup.mjs';
import { registerVerifiedConfigFixture, inspectLocalBackupCatalog, catalogRetentionSuggestions } from '../src/lifecycle/backup-catalog.mjs';
const password = 'isolated-dev-only-config-fixture-secret';

async function fixtures(t) {
  const root = await mkdtemp(join(tmpdir(), 'domyro-config-source-'));
  const directory = await mkdtemp(join(tmpdir(), 'domyro-config-backup-'));
  t.after(async () => { await rm(root, { recursive:true, force:true }); await rm(directory, {recursive:true,force:true}); });
  return {root, directory};
}
test('config fixture encrypts selected owner-controlled files and validates digests without publishing secrets', async t => {
  const {root,directory}=await fixtures(t);
  await writeFile(join(root,'core.json'), JSON.stringify({room:'Living',credential:'test-secret-never-print'}),{mode:0o600});
  await writeFile(join(root,'z2m.yaml'), 'device: simulated\nsecret: fixture-only', {mode:0o600});
  const saved=await createEncryptedConfigFixture({root,directory,
    files:[{role:'domyro_core',name:'core.json'},{role:'zigbee2mqtt',name:'z2m.yaml'}],
    name:'fixture-config.domyrobackup',password});
  assert.equal(saved.restoreReady,false);
  const inspected=await inspectEncryptedConfigFixture({directory,name:'fixture-config.domyrobackup',password});
  assert.equal(inspected.validEncryptedFixture,true);
  assert.equal(inspected.restoreTested,false);
  assert.deepEqual(inspected.files.map(x=>x.role),['domyro_core','zigbee2mqtt']);
  assert.deepEqual(await readdir(directory),['fixture-config.domyrobackup']);
  const receipt=await registerVerifiedConfigFixture({
    directory,name:'fixture-config.domyrobackup',password,
  });
  assert.equal(receipt.kind,'domyro-selected-config-fixture');
  const catalog=await inspectLocalBackupCatalog({directory,password});
  assert.equal(catalog[0].kind,'domyro-selected-config-fixture');
  assert.deepEqual(catalog[0].components,['domyro_core','zigbee2mqtt']);
  assert.equal(catalog[0].authenticated,true);
  assert.equal(catalog[0].verified,false);
  assert.equal(catalog[0].restoreTested,false);
  assert.deepEqual(catalogRetentionSuggestions(catalog).proposedRemovals,[]);
  await assert.rejects(()=>createEncryptedConfigFixture({root,directory,
    files:[{role:'domyro_core',name:'core.json'}],name:'fixture-config.domyrobackup',password}),/EEXIST/);
  await assert.rejects(()=>inspectEncryptedConfigFixture({
    directory,name:'fixture-config.domyrobackup',password:'incorrect-but-long-passphrase',
  }),/backup_authentication_failed/);
});
test('rejects symlinks, public fixtures, traversal and unsupported ownership roles',async t=>{
  const {root,directory}=await fixtures(t);
  await writeFile(join(root,'core.json'),'{"safe":true}',{mode:0o600});
  await symlink(join(root,'core.json'),join(root,'linked.json'));
  const args={root,directory,name:'invalid-config.domyrobackup',password};
  await assert.rejects(()=>createEncryptedConfigFixture({...args,files:[{role:'domyro_core',name:'../core.json'}]}),/config_filename_invalid/);
  await assert.rejects(()=>createEncryptedConfigFixture({...args,files:[{role:'matter_fabrics',name:'core.json'}]}),/config_role_not_supported/);
  await assert.rejects(()=>createEncryptedConfigFixture({...args,files:[{role:'domyro_core',name:'linked.json'}]}),/config_file_untrusted/);
  await chmod(join(root,'core.json'),0o644);
  await assert.rejects(()=>createEncryptedConfigFixture({...args,files:[{role:'domyro_core',name:'core.json'}]}),/config_file_untrusted/);
  assert.deepEqual(await readdir(directory),[]);
});
