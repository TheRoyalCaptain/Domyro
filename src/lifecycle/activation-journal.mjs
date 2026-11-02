// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Crash-visible intent for the isolated source-pointer rehearsal ONLY.
 * Not a production update journal: no process fencing, database transaction,
 * full-system restore, or permission to install on owner equipment exists.
 *
 * An fsynced intent precedes a pointer rename. A surviving intent MUST block
 * subsequent switches; inspection never silently repairs an interrupted update.
 */
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const NAME = '.activation-intent.json';
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const KIND = 'domyro-isolated-source-pointer-intent';
const MAX_BYTES = 2048;
const validVersion = value => typeof value === 'string' && VERSION.test(value) &&
  !value.includes('..');

async function syncDirectory(root) {
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function validIntent(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'gate,kind,previous,schemaVersion,target' &&
    value.schemaVersion === 1 && value.kind === KIND && value.gate === 'D-53' &&
    validVersion(value.target) &&
    (value.previous === null || validVersion(value.previous)) &&
    value.previous !== value.target;
}

export async function readActivationIntent(root) {
  let handle;
  try {
    handle = await open(join(root, NAME), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('activation_intent_unreadable', { cause: error });
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        stat.size < 1 || stat.size > MAX_BYTES) throw new Error('activation_intent_unsafe');
    let value;
    try { value = JSON.parse(await handle.readFile({ encoding: 'utf8' })); }
    catch { throw new Error('activation_intent_invalid'); }
    if (!validIntent(value)) throw new Error('activation_intent_invalid');
    return Object.freeze(value);
  } finally { await handle.close(); }
}

export async function persistActivationIntent(root, { previous, target }) {
  const intent = { schemaVersion: 1, kind: KIND, gate: 'D-53', previous, target };
  if (!validIntent(intent)) throw new TypeError('activation_intent_invalid');
  const body = JSON.stringify(intent) + '\n';
  const handle = await open(join(root, NAME),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(body); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(root);
}

export async function clearActivationIntent(root, expected) {
  const actual = await readActivationIntent(root);
  if (!actual || !expected || actual.previous !== expected.previous ||
      actual.target !== expected.target) throw new Error('activation_intent_changed');
  await unlink(join(root, NAME));
  await syncDirectory(root);
}

export { syncDirectory as syncActivationDirectory };
