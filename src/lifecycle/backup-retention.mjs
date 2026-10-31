// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic, READ-ONLY proposed backup cleanup for D-45.
 * This module NEVER deletes a file, remote backup, or storage directory.
 * The caller must independently verify each snapshot and its ownership.
 */
export const DEFAULT_RETENTION = Object.freeze({ daily: 7, weekly: 4, monthly: 12 });

function parseSnapshot(row) {
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.targetId !== 'string' || !row.targetId || typeof row.completedAt !== 'string') throw new TypeError('invalid_backup_record');
  const at = Date.parse(row.completedAt);
  if (!Number.isFinite(at) || !/^\d{4}-\d{2}-\d{2}T/.test(row.completedAt)) throw new TypeError('invalid_backup_timestamp');
  return { ...row, at };
}

function calendarBuckets(date) {
  const iso = date.toISOString();
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekdayMonday = (utcDate.getUTCDay() + 6) % 7;
  const monday = new Date(utcDate.getTime() - weekdayMonday * 86_400_000);
  return { daily: iso.slice(0, 10), weekly: monday.toISOString().slice(0, 10), monthly: iso.slice(0, 7) };
}

/**
 * Produces suggestions for *verified, owned* snapshots older than the newest
 * per-destination verified snapshot; never delete an unknown/failed/held copy.
 * Backup verification itself is outside this module.
 */
export function planBackupRetention(snapshots, policy = DEFAULT_RETENTION) {
  if (!Array.isArray(snapshots)) throw new TypeError('snapshots must be an array');
  const counts = ['daily', 'weekly', 'monthly'];
  if (!policy || !counts.every(k => Number.isSafeInteger(policy[k]) && policy[k] >= 1 && policy[k] <= 1000)) throw new TypeError('invalid_retention_policy');
  const parsed = snapshots.map(parseSnapshot);
  const unique = new Set();
  for (const snapshot of parsed) {
    if (unique.has(snapshot.id)) throw new TypeError('duplicate_backup_id');
    unique.add(snapshot.id);
  }
  const targets = new Map();
  for (const snapshot of parsed) {
    if (!targets.has(snapshot.targetId)) targets.set(snapshot.targetId, []);
    targets.get(snapshot.targetId).push(snapshot);
  }
  const keep = new Set(), removable = new Set(), manualReview = new Set();
  for (const records of targets.values()) {
    records.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const verified = records.filter(r => r.owned === true && r.verified === true && r.completed === true);
    if (verified.length) keep.add(verified[0].id); // Never automatically prune last known good recovery point.
    for (const bucketName of counts) {
      const seen = new Set();
      for (const row of verified) {
        const key = calendarBuckets(new Date(row.at))[bucketName];
        if (seen.has(key)) continue;
        if (seen.size >= policy[bucketName]) break;
        seen.add(key);
        keep.add(row.id);
      }
    }
    for (const row of records) {
      if (row.hold === true || row.owned !== true || row.verified !== true || row.completed !== true) {
        keep.add(row.id);
        if (row.owned !== true || row.verified !== true || row.completed !== true) manualReview.add(row.id);
      } else if (!keep.has(row.id) && verified.length >= 2 && row.at < verified[0].at) {
        removable.add(row.id);
      } else keep.add(row.id);
    }
  }
  return Object.freeze({
    keep: Object.freeze([...keep].sort()),
    proposedRemovals: Object.freeze([...removable].sort()),
    manualReview: Object.freeze([...manualReview].sort()),
    policy: Object.freeze({ daily: policy.daily, weekly: policy.weekly, monthly: policy.monthly }),
  });
}
