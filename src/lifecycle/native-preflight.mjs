// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem, arch as hostArch, platform as hostPlatform } from 'node:os';

/** Pure read-only eligibility assessment, not a runnable installer. */
export function assessUbuntuHost(host) {
  if (!host || typeof host !== 'object') throw new TypeError('host is required');
  const blockers = [], notices = [];
  if (host.platform !== 'linux' || host.osId !== 'ubuntu') blockers.push('ubuntu_required');
  if (!['x64', 'arm64'].includes(host.arch)) blockers.push('architecture_unsupported');
  if (host.osId === 'ubuntu' && !host.isLts) blockers.push('ubuntu_lts_required');
  if (!Number.isFinite(host.cpuCount) || host.cpuCount < 2) blockers.push('insufficient_cpus');
  if (!Number.isFinite(host.ramBytes) || host.ramBytes < 4 * 1024 ** 3) blockers.push('insufficient_memory');
  if (!Number.isFinite(host.freeDiskBytes) || host.freeDiskBytes < 8 * 1024 ** 3) blockers.push('insufficient_disk');
  if (host.hasExistingDomyro === true) notices.push('existing_install_requires_upgrade_flow');
  if (host.portAvailable === false) blockers.push('port_in_use');
  if (host.osId === 'ubuntu' && !/^\d{2}\.04$/.test(host.versionId ?? '')) blockers.push('unsupported_version_format');
  return Object.freeze({
    eligibleForPlanner: blockers.length === 0,
    blockers, notices, sideEffects: false,
    mappedArchitecture: host.arch === 'x64' ? 'amd64' : host.arch === 'arm64' ? 'arm64' : null,
  });
}

/** Local host inspection ONLY; produces a report without modifying the host. */
export async function inspectLocalHost({ path = '/', portAvailable } = {}) {
  const raw = await readFile('/etc/os-release', 'utf8');
  const fields = Object.fromEntries(raw.split('\n').map(line => /^([A-Z_]+)=(.*)$/.exec(line)).filter(Boolean).map(m => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
  const disk = await statfs(path);
  const host = {
    platform: hostPlatform(), arch: hostArch(), osId: fields.ID, versionId: fields.VERSION_ID,
    isLts: /\bLTS\b/.test(fields.VERSION ?? '') || /\bLTS\b/.test(fields.VERSION_CODENAME ?? ''),
    cpuCount: cpus().length, ramBytes: totalmem(), availableMemoryBytes: freemem(),
    freeDiskBytes: disk.bavail * disk.bsize, portAvailable,
  };
  return Object.freeze({ host, assessment: assessUbuntuHost(host) });
}
