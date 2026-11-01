// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { selectSignedUpdateFromCatalog } from '../src/lifecycle/signed-release-catalog.mjs';

const keys = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const base = {
  trustedPublicKeyPem, currentVersion: '1.0.0', os: 'ubuntu',
  arch: 'amd64', currentDatabaseSchema: 3,
  now: new Date('2026-11-02T03:00:00Z'),
};
const hash = createHash('sha256').update('isolated test artifact').digest('hex');
function signed(version, {
  publishedAt = '2026-10-30T12:00:00Z', channel = 'stable',
  arch = 'amd64', schema = 3, migration = 'none', file = 'domyro.bundle',
} = {}) {
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, version, channel, publishedAt,
    database: { min: schema, max: schema, target: schema, migration },
    artifacts: [{ os: 'ubuntu', arch, file, bytes: 22, sha256: hash }],
  }));
  return {
    manifestBytes,
    signatureBase64: sign(null, manifestBytes, keys.privateKey).toString('base64'),
  };
}
function choose(releases, opts = {}) {
  return selectSignedUpdateFromCatalog({ ...base, releases, ...opts });
}
test('highest compatible signed SemVer wins regardless of publication or input order', () => {
  const got = choose([
    signed('1.1.0', { publishedAt: '2026-11-01T12:00:00Z' }),
    signed('1.3.0', { publishedAt: '2026-10-29T12:00:00Z' }),
    signed('1.2.0'),
  ]);
  assert.equal(got.state, 'candidate_selected');
  assert.equal(got.selected.version, '1.3.0');
  assert.equal(got.selected.downloadState, 'update_available');
  assert.match(got.selected.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(got.selected.installAllowed, false);
  assert.equal(got.installAllowed, false);
  assert.equal(got.automaticInstall, false);
  assert.equal(got.installationGate, 'D-53');
  assert.equal(got.trustedCount, 3);
});
test('unsupported newest releases do not hide an older compatible signed version', () => {
  const got = choose([
    signed('2.0.0', { schema: 4 }),
    signed('1.9.0', { arch: 'arm64' }),
    signed('1.7.0'),
  ]);
  assert.equal(got.selected.version, '1.7.0');
  assert.equal(got.newestTrusted, '2.0.0');
});
test('stable preference rejects prerelease but beta preference accepts it', () => {
  const releases = [
    signed('1.2.0-beta.2', { channel: 'beta' }),
    signed('1.1.0'),
  ];
  assert.equal(choose(releases).selected.version, '1.1.0');
  assert.equal(choose(releases, { preferences: { channel: 'beta' } }).selected.version, '1.2.0-beta.2');
});
test('invalid signature and unsigned entries are not trusted or selected', () => {
  const good = signed('1.3.0');
  const tampered = { ...signed('8.0.0'), signatureBase64: good.signatureBase64 };
  const got = choose([tampered, null, good]);
  assert.equal(got.selected.version, '1.3.0');
  assert.equal(got.untrustedCount, 2);
  assert.equal(got.trustedCount, 1);
  const empty = choose([tampered]);
  assert.equal(empty.state, 'untrusted_or_empty_catalog');
  assert.equal(empty.selected, null);
});
test('conflicting valid signed manifests for the SAME version block the entire catalog', () => {
  const a = signed('1.5.0', { file: 'first.bundle' });
  const b = signed('1.5.0', { file: 'second.bundle' });
  const got = choose([signed('1.8.0'), a, b]);
  assert.equal(got.state, 'catalog_equivocation');
  assert.deepEqual(got.blockers, ['conflicting_signed_manifests_for_version']);
  assert.equal(got.selected, null);
  assert.equal(got.installAllowed, false);
});
test('byte-identical duplicate signed manifests are deduplicated', () => {
  const release = signed('1.2.0');
  const got = choose([release, release]);
  assert.equal(got.state, 'candidate_selected');
  assert.equal(got.trustedCount, 1);
  assert.equal(got.duplicateCount, 1);
});
test('trusted high-water mark rejects a catalog rollback, even when signatures are valid', () => {
  const got = choose([signed('1.4.0')], { highestSeenVersion: '1.8.0' });
  assert.equal(got.state, 'catalog_rollback_detected');
  assert.equal(got.selected, null);
  assert.deepEqual(got.blockers, ['trusted_release_high_water_mark_not_met']);
  assert.equal(got.installAllowed, false);
  const accepted = choose([signed('1.8.0'), signed('1.4.0')], { highestSeenVersion: '1.8.0' });
  assert.equal(accepted.selected.version, '1.8.0');
});
test('high-water mark never allows selecting an older version when a newer one is incompatible', () => {
  const got = choose([signed('1.9.0', { schema: 4 }), signed('1.6.0')], {
    highestSeenVersion: '1.8.0',
  });
  assert.equal(got.state, 'no_supported_release');
  assert.equal(got.selected, null);
});
test('download delay only enables downloading and never installation', () => {
  const got = choose([signed('1.5.0', { publishedAt: '2026-11-02T00:00:00Z' })], {
    now: new Date('2026-11-02T03:00:00Z'),
    preferences: { automaticChecks: true, automaticDownloads: true, downloadDelayHours: 12 },
  });
  assert.equal(got.selected.downloadState, 'scheduled_for_download');
  assert.equal(got.selected.mayDownloadAutomatically, false);
  assert.equal(got.selected.installAllowed, false);
  const later = choose([signed('1.5.0', { publishedAt: '2026-11-02T00:00:00Z' })], {
    now: new Date('2026-11-03T03:00:00Z'),
    preferences: { automaticChecks: true, automaticDownloads: true, downloadDelayHours: 12 },
  });
  assert.equal(later.selected.downloadState, 'download_eligible');
  assert.equal(later.selected.mayDownloadAutomatically, true);
  assert.equal(later.installAllowed, false);
});
test('future-dated, older, and incompatible signed releases cannot become candidates', () => {
  const got = choose([
    signed('2.0.0', { publishedAt: '2026-11-04T12:00:00Z' }),
    signed('0.9.0'),
    signed('1.1.0', { migration: 'reversible' }),
  ]);
  assert.equal(got.state, 'no_supported_release');
  assert.equal(got.selected, null);
});
test('invalid trust, date, installed version, high-water mark and unbounded catalogs fail closed', () => {
  assert.throws(() => choose([], { trustedPublicKeyPem: '' }), /pinned_publisher_key_required/);
  assert.throws(() => choose([], { now: new Date(NaN) }), /release_catalog_time_invalid/);
  assert.throws(() => choose([], { currentVersion: 'invalid' }), /version/);
  assert.throws(() => choose([], { highestSeenVersion: 'invalid' }), /version/);
  assert.throws(() => choose(Array(65).fill(signed('1.1.0'))), /release_catalog_size_invalid/);
  assert.throws(() => choose([], { preferences: { automaticChecks: false, automaticDownloads: true } }), /downloads_require_automatic_checks/);
  assert.equal(choose([]).installAllowed, false);
});
