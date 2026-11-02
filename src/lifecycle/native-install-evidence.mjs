// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Non-destructive Ubuntu installer evidence collection.
 * Reads only OS/kernel snapshots and fixed local file metadata. It never
 * opens a listening socket, connects to devices, invokes a package manager,
 * writes files, starts services or authorizes installation.
 *
 * A free port in a /proc snapshot is NOT a reservation: the real installer
 * must independently recheck/bind immediately before starting its service.
 */
import { constants } from 'node:fs';
import { access, lstat, readFile } from 'node:fs/promises';
import { inspectLocalHost, assessUbuntuHost } from './native-preflight.mjs';

export const INSTALL_PATHS = Object.freeze([
  '/opt/domyro',
  '/etc/domyro',
  '/var/lib/domyro',
  '/etc/systemd/system/domyro.service',
  '/run/systemd/system/domyro.service',
]);
const REQUIRED_TOOLS = Object.freeze({
  aptGet: '/usr/bin/apt-get',
  systemctl: '/usr/bin/systemctl',
});
const LISTEN = '0A';
const MIN_NODE = [22, 12, 0];
const SUPPORTED_UBUNTU = new Set(['24.04']);
const MAX_PROC_BYTES = 2 * 1024 * 1024;
const freeze = value => Object.freeze(value);

function parseVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  const numbers = version.split('.').map(Number);
  return numbers.every(Number.isSafeInteger) ? numbers : null;
}
function supportedRuntime(version) {
  const actual = parseVersion(version);
  if (!actual) return false;
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== MIN_NODE[i]) return actual[i] > MIN_NODE[i];
  }
  return true;
}
function validPort(value) {
  return Number.isSafeInteger(value) && value >= 1024 && value <= 65535 &&
    !new Set([1883, 8883, 5432, 22, 80, 443]).has(value);
}

/** Decode Linux /proc/net/tcp and tcp6 LISTEN rows without DNS, sockets or commands. */
export function parseProcTcpListeningPorts(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PROC_BYTES) {
    throw new Error('tcp_snapshot_invalid');
  }
  const ports = new Set();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (index === 0 && fields[0] === 'sl') continue;
    if (!/^\d+:$/.test(fields[0] ?? '') || fields.length < 4 ||
        !/^[a-fA-F0-9]+:[a-fA-F0-9]{4}$/.test(fields[1] ?? '') ||
        !/^[a-fA-F0-9]+:[a-fA-F0-9]{4}$/.test(fields[2] ?? '') ||
        !/^[a-fA-F0-9]{2}$/.test(fields[3] ?? '')) {
      throw new Error('tcp_snapshot_unparseable');
    }
    if (fields[3].toUpperCase() !== LISTEN) continue;
    const port = Number.parseInt(fields[1].split(':').at(-1), 16);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  return ports;
}

function normalizePathFindings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native_paths_evidence_invalid');
  return INSTALL_PATHS.map(path => {
    const state = value[path];
    if (!['absent', 'present', 'unknown'].includes(state)) throw new TypeError('native_paths_evidence_invalid');
    return freeze({ path, state });
  });
}

/**
 * Pure decision over measured evidence. In particular, an empty listening-port
 * set is trusted only if BOTH IPv4 and IPv6 /proc tables were read successfully.
 * A selected "existing" PostgreSQL/MQTT port does NOT verify credentials.
 */
export function assessNativeInstallEvidence({
  host, requestedPort = 8844, pathStates,
  tools = {}, systemdBooted = false, nodeVersion,
  ipv4ListeningPorts = null, ipv6ListeningPorts = null,
} = {}) {
  const eligibility = assessUbuntuHost(host);
  const blockers = [...eligibility.blockers];
  const notices = [...eligibility.notices];
  if (host.osId === 'ubuntu' && !SUPPORTED_UBUNTU.has(host.versionId)) {
    blockers.push('ubuntu_release_not_yet_tested');
  }
  const paths = normalizePathFindings(pathStates);
  for (const item of paths) {
    if (item.state === 'present') blockers.push('native_target_already_exists:' + item.path);
    if (item.state === 'unknown') blockers.push('native_target_uninspectable:' + item.path);
  }
  if (!systemdBooted) blockers.push('systemd_pid1_not_verified');
  for (const [name] of Object.entries(REQUIRED_TOOLS)) {
    if (tools[name] !== true) blockers.push('native_tool_missing_or_unverified:' + name);
  }
  if (!supportedRuntime(nodeVersion)) {
    // The official installer must provision a compatible runtime, not assume
    // that Ubuntu's default node package meets the signed app's requirements.
    notices.push('node_runtime_provisioning_required');
  }
  if (!validPort(requestedPort)) blockers.push('native_requested_port_invalid');
  const validSnapshot = ipv4ListeningPorts instanceof Set &&
    ipv6ListeningPorts instanceof Set &&
    [...ipv4ListeningPorts, ...ipv6ListeningPorts].every(
      n => Number.isSafeInteger(n) && n >= 1 && n <= 65535);
  if (!validSnapshot) blockers.push('native_tcp_snapshot_unverified');
  else if (validPort(requestedPort) &&
      (ipv4ListeningPorts.has(requestedPort) || ipv6ListeningPorts.has(requestedPort))) {
    blockers.push('native_port_occupied_at_inspection');
  }
  return freeze({
    gate: 'D-53',
    installed: false,
    installationAllowed: false,
    hostModified: false,
    inspectedPort: validPort(requestedPort) ? requestedPort : null,
    portObservation: !validSnapshot ? 'unknown' :
      ipv4ListeningPorts.has(requestedPort) || ipv6ListeningPorts.has(requestedPort) ?
        'occupied' : 'not_observed_in_listen_snapshot',
    portAvailabilityGuaranteed: false,
    serviceCredentialsVerified: false,
    requiredInstallPaths: freeze(paths),
    toolEvidence: freeze(Object.fromEntries(Object.keys(REQUIRED_TOOLS).map(k => [k, tools[k] === true]))),
    supportedNodeRuntimePresent: supportedRuntime(nodeVersion),
    hostAssessment: eligibility,
    blockers: freeze([...new Set(blockers)]),
    notices: freeze([...new Set(notices)]),
    planCanProceed: blockers.length === 0,
  });
}

async function statPath(path) {
  try {
    await lstat(path); // lstat detects symlinks as collisions, never follows them.
    return 'present';
  } catch (error) {
    return error.code === 'ENOENT' ? 'absent' : 'unknown';
  }
}
async function executable(path) {
  try { await access(path, constants.X_OK); return true; }
  catch { return false; }
}
async function readTcp(path) {
  try {
    const content = await readFile(path, 'utf8');
    return parseProcTcpListeningPorts(content);
  } catch { return null; } // unknown is a blocker, not a free port.
}

/** Fixed-path read-only inspection, suitable for an unprivileged diagnostics CLI. */
export async function inspectNativeInstallEvidence({ requestedPort = 8844 } = {}) {
  const { host } = await inspectLocalHost();
  const pathEntries = await Promise.all(INSTALL_PATHS.map(async path => [path, await statPath(path)]));
  const toolEntries = await Promise.all(Object.entries(REQUIRED_TOOLS).map(async ([name,path]) =>
    [name, await executable(path)]));
  const [systemdBooted, ipv4ListeningPorts, ipv6ListeningPorts] = await Promise.all([
    statPath('/run/systemd/system').then(state => state === 'present'),
    readTcp('/proc/net/tcp'),
    readTcp('/proc/net/tcp6'),
  ]);
  const assessment = assessNativeInstallEvidence({
    host, requestedPort, pathStates: Object.fromEntries(pathEntries),
    tools: Object.fromEntries(toolEntries), systemdBooted,
    nodeVersion: process.versions.node, ipv4ListeningPorts, ipv6ListeningPorts,
  });
  // Only counts, not potentially private socket addresses or credentials.
  return freeze({
    host: freeze({
      osId: host.osId, versionId: host.versionId, arch: host.arch,
      cpuCount: host.cpuCount, ramBytes: host.ramBytes,
      freeDiskBytes: host.freeDiskBytes,
    }),
    assessment,
  });
}
