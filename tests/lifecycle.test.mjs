// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { compareVersions, verifySignedManifest, verifyArtifactBytes, assessManualUpgrade } from '../src/lifecycle/release.mjs';
import { DEFAULT_RETENTION, planBackupRetention } from '../src/lifecycle/backup-retention.mjs';
import { planSupportingServices } from '../src/lifecycle/install-plan.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const binary = Buffer.from('only a test artifact, not a distributable package');
function signedRelease(overrides = {}) {
  const manifest = {
    schemaVersion: 1, version: '0.1.1', channel: 'stable', publishedAt: '2026-10-30T12:00:00Z',
    database: { min: 0, max: 0, target: 0, migration: 'none' },
    artifacts: [{ os: 'ubuntu', arch: 'amd64', file: 'domyro-0.1.1-amd64.tar.gz', bytes: binary.byteLength, sha256: createHash('sha256').update(binary).digest('hex') }],
    ...overrides,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return { manifestBytes, signatureBase64: sign(null, manifestBytes, privateKey).toString('base64'), trustedPublicKeyPem: publicPem };
}
function goodPreflight() {
  return { ...signedRelease(), currentVersion: '0.1.0', os: 'ubuntu', arch: 'amd64', currentDatabaseSchema: 0,
    availableBytes: 200 * 1024 * 1024, now: new Date('2026-10-31T12:00:00.000Z'), adminConfirmedVersion: '0.1.1',
    backup: { forVersion: '0.1.0', verified: true, restoreValidated: true, includesDatabase: true, includesConfig: true, includesSecrets: true, completedAt: '2026-10-31T11:45:00Z' },
  };
}

test('SemVer comparison handles version order, prereleases and rejects bad versions', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.2'), 1);
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.11'), -1);
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('0.0.1', '0.0.1'), 0);
  assert.throws(() => compareVersions('01.2.3', '1.2.3'), /strict SemVer/);
  assert.throws(() => compareVersions('1.2.3-alpha.01', '1.2.3'), /invalid prerelease/);
});

test('Ed25519 signatures protect original bytes and artifact digest', () => {
  const signed = signedRelease();
  const manifest = verifySignedManifest(signed);
  assert.equal(manifest.version, '0.1.1');
  assert.equal(verifyArtifactBytes(manifest.artifacts[0], binary), true);
  assert.equal(verifyArtifactBytes(manifest.artifacts[0], Buffer.from('tampered package')), false);
  assert.throws(() => verifySignedManifest({ ...signed, manifestBytes: Buffer.from(signed.manifestBytes.toString().replace('0.1.1', '0.1.2')) }), /signature_untrusted/);
  const rogue = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => verifySignedManifest({ ...signed, trustedPublicKeyPem: rogue }), /signature_untrusted/);
  assert.throws(() => verifySignedManifest(signedRelease({ artifacts: [manifest.artifacts[0], manifest.artifacts[0]] })), /duplicate_artifact_target/);
  assert.throws(() => verifySignedManifest(signedRelease({ artifacts: [{ ...manifest.artifacts[0], file: '../../evil' }] })), /artifact_invalid/);
  assert.throws(() => verifySignedManifest(signedRelease({ schemaVersion: 200 })), /schema_unsupported/);
  assert.throws(() => verifySignedManifest(signedRelease({ version: '1.0.0-preview', channel: 'stable' })), /stable_prerelease_not_allowed/);
});

test('Update policy denies every unsafe or unapproved update', () => {
  const base = goodPreflight();
  assert.deepEqual(assessManualUpgrade(base).blockers, []);
  assert.equal(assessManualUpgrade(base).allowed, true);
  const cases = [
    [{ adminConfirmedVersion: undefined }, 'explicit_manual_approval_required'],
    [{ arch: 'arm64' }, 'unsupported_platform'],
    [{ currentVersion: '0.2.0' }, 'not_a_newer_version'],
    [{ availableBytes: 1 }, 'insufficient_disk_space'],
    [{ currentDatabaseSchema: 1 }, 'database_schema_unsupported'],
    [{ backup: { ...base.backup, verified: false } }, 'fresh_verified_backup_required'],
    [{ backup: { ...base.backup, completedAt: '2026-10-29T11:45:00Z' } }, 'fresh_verified_backup_required'],
    [{ signatureBase64: '' }, 'unverified_release'],
    [{ manifestBytes: Buffer.from('not signed') }, 'unverified_release'],
  ];
  for (const [override, reason] of cases) {
    const result = assessManualUpgrade({ ...base, ...override });
    assert.equal(result.allowed, false, JSON.stringify(override));
    assert.ok(result.blockers.includes(reason), 'Expected blocker ' + reason + ', got ' + result.blockers);
  }
  const irreversible = signedRelease({ database: { min: 0, max: 1, target: 1, migration: 'irreversible' } });
  const incompatible = assessManualUpgrade({ ...base, ...irreversible });
  assert.equal(incompatible.allowed, false);
  assert.ok(incompatible.blockers.includes('migration_not_yet_supported'));
});

function backup(day, id, targetId = 'nas', extras = {}) {
  return { id, targetId, completedAt: new Date(Date.UTC(2026, 9, day, 12)).toISOString(), completed: true, owned: true, verified: true, ...extras };
}

test('D-45 retention uses independent target buckets and never removes a last good backup', () => {
  assert.deepEqual(DEFAULT_RETENTION, { daily: 7, weekly: 4, monthly: 12 });
  const snapshots = Array.from({ length: 30 }, (_, i) => backup(i + 1, 'nas-' + (i + 1)));
  snapshots.push(backup(1, 'usb-1', 'usb'));
  snapshots.push(backup(2, 'usb-failed', 'usb', { verified: false }));
  snapshots.push(backup(3, 'nas-held', 'nas', { hold: true }));
  snapshots.push(backup(4, 'nas-foreign', 'nas', { owned: false }));
  const plan = planBackupRetention(snapshots);
  assert.equal(plan.proposedRemovals.includes('usb-1'), false);
  assert.ok(plan.keep.includes('usb-1'));
  assert.ok(plan.keep.includes('usb-failed'));
  assert.ok(plan.keep.includes('nas-held'));
  assert.ok(plan.keep.includes('nas-foreign'));
  assert.ok(plan.keep.includes('nas-30'));
  assert.ok(plan.proposedRemovals.some(x => x.startsWith('nas-')));
  assert.ok(plan.manualReview.includes('usb-failed'));
  assert.equal(planBackupRetention([backup(1, 'one')]).proposedRemovals.length, 0);
  assert.throws(() => planBackupRetention([backup(1, 'same'), backup(2, 'same')]), /duplicate/);
  assert.throws(() => planBackupRetention([], { daily: 0, weekly: 4, monthly: 12 }), /invalid_retention_policy/);
});

test('Installer service plan is non-mutating and refuses to seize external services', () => {
  const decisions = { postgresql: 'managed', mosquitto: 'external', zigbee2mqtt: 'defer', 'matter-server': 'defer' };
  const broker = [{ id: 'mosquitto', managedByDomyro: false, running: true }];
  const first = planSupportingServices(decisions, broker);
  assert.equal(first.valid, true);
  assert.equal(first.sideEffects, false);
  assert.deepEqual(first.steps.map(s => s.action), ['propose_managed_install', 'connect_existing', 'skip_optional', 'skip_optional']);
  assert.equal(planSupportingServices({ ...decisions, mosquitto: 'managed' }, broker).problems[0].reason, 'existing_service_not_owned');
  assert.equal(planSupportingServices({ ...decisions, postgresql: 'defer' }, broker).problems[0].reason, 'required_service_cannot_be_deferred');
  assert.equal(planSupportingServices(decisions, []).problems[0].reason, 'external_service_not_available');
  assert.equal(planSupportingServices({ ...decisions, mosquitto: 'nope' }, broker).valid, false);
  assert.throws(() => planSupportingServices({ ...decisions, arbitrary: 'managed' }), /unknown_service/);
  assert.equal(decisions.postgresql, 'managed'); // no mutation
});
