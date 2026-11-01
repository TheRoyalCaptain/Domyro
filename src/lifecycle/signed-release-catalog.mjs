// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline, read-only signed release catalog selection for the development
 * Update Center. This module performs NO HTTP, downloads, writes, activation,
 * migration, service restart or authorization. D-53 remains CLOSED.
 *
 * The caller must pin the publisher key out of band and persist a trusted
 * highest-seen version separately before a production feed can be built.
 */
import { createHash } from 'node:crypto';
import { compareVersions, verifySignedManifest } from './release.mjs';
import { assessSignedUpdateCandidate, normalizeUpdatePreferences } from './update-center.mjs';

const MAX_CATALOG_ENTRIES = 64;
const NO_INSTALL = Object.freeze({
  installAllowed: false, automaticInstall: false,
  manualInstallRequired: true, installationGate: 'D-53',
});

function result(state, fields = {}) {
  return Object.freeze({ ...NO_INSTALL, state, ...fields });
}

/**
 * Select the newest compatible, signed release by SemVer, NOT publication
 * order. Invalid signatures are ignored and counted, not trusted as metadata.
 * Equivocation (different signed bytes for one version) blocks the catalog.
 * A previously trusted high-water mark blocks catalog rollback.
 *
 * The high-water mark must come from trusted, durable local storage; a remote
 * feed is never allowed to supply or reset it. This is an offline prototype.
 */
export function selectSignedUpdateFromCatalog({
  releases, trustedPublicKeyPem, currentVersion,
  os = 'ubuntu', arch, currentDatabaseSchema,
  preferences = {}, now = new Date(), highestSeenVersion = null,
} = {}) {
  if (!Array.isArray(releases) || releases.length > MAX_CATALOG_ENTRIES) {
    throw new TypeError('release_catalog_size_invalid');
  }
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem) {
    throw new TypeError('pinned_publisher_key_required');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('release_catalog_time_invalid');
  }
  const config = normalizeUpdatePreferences(preferences);
  // Never accept malformed installed/high-water versions as a downgrade path.
  compareVersions(currentVersion, currentVersion);
  if (highestSeenVersion !== null) {
    compareVersions(highestSeenVersion, highestSeenVersion);
  }

  const seen = new Map();
  let untrustedCount = 0;
  let duplicateCount = 0;
  let newestTrusted = null;
  const candidates = [];
  for (const entry of releases) {
    let manifest;
    try {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('release_catalog_entry_invalid');
      }
      manifest = verifySignedManifest({
        manifestBytes: entry.manifestBytes,
        signatureBase64: entry.signatureBase64,
        trustedPublicKeyPem,
      });
    } catch {
      untrustedCount++;
      continue;
    }
    const digest = createHash('sha256').update(entry.manifestBytes).digest('hex');
    const prior = seen.get(manifest.version);
    if (prior !== undefined) {
      if (prior !== digest) {
        return result('catalog_equivocation', {
          blockers: Object.freeze(['conflicting_signed_manifests_for_version']),
          selected: null, untrustedCount, duplicateCount,
          trustedCount: seen.size,
        });
      }
      duplicateCount++;
      continue;
    }
    seen.set(manifest.version, digest);
    if (newestTrusted === null || compareVersions(manifest.version, newestTrusted) > 0) {
      newestTrusted = manifest.version;
    }
    const advice = assessSignedUpdateCandidate({
      manifestBytes: entry.manifestBytes,
      signatureBase64: entry.signatureBase64, trustedPublicKeyPem,
      currentVersion, os, arch, currentDatabaseSchema,
      preferences: config, now,
    });
    candidates.push({ manifest, digest, advice });
  }

  if (highestSeenVersion !== null && (newestTrusted === null ||
      compareVersions(newestTrusted, highestSeenVersion) < 0)) {
    return result('catalog_rollback_detected', {
      blockers: Object.freeze(['trusted_release_high_water_mark_not_met']),
      selected: null, newestTrusted, highestSeenVersion,
      trustedCount: seen.size, untrustedCount, duplicateCount,
    });
  }

  const eligible = candidates.filter(({ manifest, advice }) =>
    ['update_available', 'scheduled_for_download', 'download_eligible'].includes(advice.state) &&
    (highestSeenVersion === null || compareVersions(manifest.version, highestSeenVersion) >= 0));
  eligible.sort((a, b) => compareVersions(b.manifest.version, a.manifest.version));
  const selected = eligible[0] ?? null;
  if (!selected) {
    return result(seen.size ? 'no_supported_release' : 'untrusted_or_empty_catalog', {
      selected: null, newestTrusted, highestSeenVersion,
      trustedCount: seen.size, untrustedCount, duplicateCount,
    });
  }
  return result('candidate_selected', {
    selected: Object.freeze({
      version: selected.manifest.version,
      manifestSha256: selected.digest,
      channel: selected.manifest.channel,
      publishedAt: selected.manifest.publishedAt,
      downloadState: selected.advice.state,
      mayDownloadAutomatically: selected.advice.mayDownloadAutomatically,
      eligibleAt: selected.advice.eligibleAt,
      artifact: selected.advice.artifact,
      // This is only an offline discovery result, never install permission.
      installAllowed: false,
    }),
    newestTrusted, highestSeenVersion,
    trustedCount: seen.size, untrustedCount, duplicateCount,
  });
}
