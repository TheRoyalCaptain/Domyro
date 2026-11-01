// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure authenticated release advice for the development Update Center.
 * No network access, filesystem modifications, package execution, timers,
 * downloads, service restarts, migrations or approval bypass.
 */
import { compareVersions, verifySignedManifest } from './release.mjs';

const CHANNELS = new Set(['stable', 'beta']);
const HOURS = new Set([0, 12, 24, 72, 168]);
const LIMIT_HOURS = 720;
const MAX_FUTURE_MS = 5 * 60_000;

export function normalizeUpdatePreferences({
  automaticChecks = true,
  automaticDownloads = false,
  channel = 'stable',
  downloadDelayHours = 24,
} = {}) {
  if (typeof automaticChecks !== 'boolean' || typeof automaticDownloads !== 'boolean' ||
      !CHANNELS.has(channel) || !Number.isSafeInteger(downloadDelayHours) ||
      downloadDelayHours < 0 || downloadDelayHours > LIMIT_HOURS) {
    throw new TypeError('update_preferences_invalid');
  }
  // A user who turned checking off must not have unexpected background traffic.
  if (!automaticChecks && automaticDownloads) throw new Error('downloads_require_automatic_checks');
  return Object.freeze({
    automaticChecks, automaticDownloads, channel, downloadDelayHours,
    // Intentionally not configurable. D-13 and D-53.
    automaticInstall: false, manualInstallRequired: true,
  });
}

function futureDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('invalid_update_check_time');
  return date;
}

/**
 * Evaluates a signed manifest previously obtained by a separate *authorized*
 * release discovery process. A valid manifest never constitutes install consent.
 */
export function assessSignedUpdateCandidate({
  manifestBytes, signatureBase64, trustedPublicKeyPem,
  currentVersion, os = 'ubuntu', arch, currentDatabaseSchema,
  preferences = {}, now = new Date(),
}) {
  const config = normalizeUpdatePreferences(preferences);
  const checkedAt = futureDate(now);
  let manifest;
  try {
    manifest = verifySignedManifest({ manifestBytes, signatureBase64, trustedPublicKeyPem });
  } catch {
    return Object.freeze({
      state: 'untrusted_release', blockers: Object.freeze(['unverified_release']),
      targetVersion: null, installAllowed: false, mayDownloadAutomatically: false,
      manualInstallRequired: true, checkedAt: checkedAt.toISOString(),
    });
  }

  const blockers = [];
  let newer = false;
  try { newer = compareVersions(manifest.version, currentVersion) > 0; }
  catch { blockers.push('installed_version_unknown'); }
  if (manifest.channel === 'beta' && config.channel !== 'beta') blockers.push('channel_not_selected');
  if (Date.parse(manifest.publishedAt) > checkedAt.getTime() + MAX_FUTURE_MS) blockers.push('release_in_future');
  const artifact = manifest.artifacts.find(item => item.os === os && item.arch === arch);
  if (!artifact) blockers.push('artifact_for_host_missing');
  if (!Number.isSafeInteger(currentDatabaseSchema) || currentDatabaseSchema < manifest.database.min ||
      currentDatabaseSchema > manifest.database.max) blockers.push('schema_incompatible');
  if (manifest.database.target !== currentDatabaseSchema || manifest.database.migration !== 'none') {
    blockers.push('migration_not_proven_safe');
  }
  // This project currently has no proven native full-install or update engine.
  const eligibleAtMillis = Date.parse(manifest.publishedAt) + config.downloadDelayHours * 3600_000;
  const eligibleAt = Number.isFinite(eligibleAtMillis) ? new Date(eligibleAtMillis).toISOString() : null;
  let state;
  if (blockers.length) state = 'unsupported';
  else if (!newer) state = 'up_to_date';
  else if (!config.automaticDownloads) state = 'update_available';
  else if (eligibleAtMillis > checkedAt.getTime()) state = 'scheduled_for_download';
  else state = 'download_eligible';
  return Object.freeze({
    state, blockers: Object.freeze(blockers), targetVersion: manifest.version,
    currentVersion, channel: manifest.channel, publishedAt: manifest.publishedAt,
    eligibleAt, artifact: artifact ? Object.freeze({
      os: artifact.os, arch: artifact.arch, bytes: artifact.bytes, sha256: artifact.sha256,
    }) : null,
    mayDownloadAutomatically: config.automaticChecks && config.automaticDownloads &&
      state === 'download_eligible',
    installAllowed: false, // Invariant: even signed releases are never installed by discovery.
    manualInstallRequired: true,
    verifiedPublisherSignature: true,
    checkedAt: checkedAt.toISOString(),
  });
}

/** No official key/feed configured until owner-approved release pipeline exists. */
export function getDevelopmentUpdateStatus({ currentVersion = '0.1.0-dev.1' } = {}) {
  return Object.freeze({
    service: 'domyro', currentVersion, state: 'release_feed_not_configured',
    targetVersion: null, verifiedPublisherSignature: false,
    checksImplemented: true, signedFeedConfigured: false,
    downloadImplemented: false, manualInstallerImplemented: false,
    installAllowed: false, automaticInstall: false, installationGate: 'D-53',
    blockers: Object.freeze([
      'official_signing_key_and_release_feed_missing',
      'native_one_command_installer_not_verified',
      'full_system_backup_and_recovery_not_verified',
      'manual_update_engine_not_verified',
    ]),
  });
}
