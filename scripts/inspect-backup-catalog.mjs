#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Developer-only READ-ONLY local backup catalog CLI. No deletion, scheduling,
 * migrations, file copying, service control or hidden password prompts.
 */
import { constants as flags } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { inspectLocalBackupCatalog, catalogRetentionSuggestions } from '../src/lifecycle/backup-catalog.mjs';

async function privatePasswordFile(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('absolute_password_file_required');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 12 || stat.size > 2048 || (stat.mode & 0o077)) {
    throw new Error('password_file_not_private');
  }
  const handle = await open(path, flags.O_RDONLY | flags.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.ino !== stat.ino || after.dev !== stat.dev || (after.mode & 0o077)) throw new Error('password_file_changed');
    return (await handle.readFile('utf8')).replace(/\r?\n$/, '');
  } finally { await handle.close(); }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 4 || args[0] !== '--directory' ||
      (args.length === 4 && args[2] !== '--password-file') ||
      (args.length === 3)) throw new Error('usage: node scripts/inspect-backup-catalog.mjs --directory <private-absolute-dir> [--password-file <private-absolute-file>]');
  const directory = args[1];
  if (!directory.startsWith('/')) throw new Error('absolute_backup_directory_required');
  const password = args.length === 4 ? await privatePasswordFile(args[3]) : null;
  const entries = await inspectLocalBackupCatalog({ directory, password });
  const suggestions = catalogRetentionSuggestions(entries);
  // No record can become eligible for pruning without real restore evidence,
  // which the current catalog does not issue. The CLI cannot delete anything.
  console.log(JSON.stringify({
    status: 'development_only',
    operation: 'read_only',
    total: entries.length,
    authenticated: entries.filter(x => x.authenticated).length,
    provenRestorable: entries.filter(x => x.restoreTested).length,
    catalog: entries.map(({ filename, kind, components, authenticated, restoreTested, reason }) =>
      ({ filename, kind:kind??null, components:components??[], authenticated, restoreTested, reason })),
    retention: { candidateRemovals: suggestions.proposedRemovals,
      requiresManualReview: suggestions.manualReview },
  }, null, 2));
}
main().catch(error => {
  const allowed = ['usage:', 'absolute_password_file_required', 'password_file_not_private',
    'password_file_changed', 'absolute_backup_directory_required',
    'backup_directory_must_be_private', 'catalog_entry_limit'];
  console.error(allowed.some(prefix => error.message?.startsWith(prefix)) ? error.message : 'backup_catalog_inspection_failed');
  process.exitCode = 1;
});
