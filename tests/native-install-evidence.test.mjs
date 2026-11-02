// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_PATHS, parseProcTcpListeningPorts, assessNativeInstallEvidence,
} from '../src/lifecycle/native-install-evidence.mjs';

const host = {
  platform: 'linux', osId: 'ubuntu', versionId: '24.04', isLts: true,
  arch: 'x64', cpuCount: 4, ramBytes: 8 * 1024 ** 3,
  freeDiskBytes: 40 * 1024 ** 3, portAvailable: true,
  hasExistingDomyro: false,
};
const cleanPaths = Object.fromEntries(INSTALL_PATHS.map(p => [p, 'absent']));
const base = {
  host, pathStates: cleanPaths, requestedPort: 8844,
  tools: { aptGet: true, systemctl: true }, systemdBooted: true,
  nodeVersion: '22.12.0',
  ipv4ListeningPorts: new Set(), ipv6ListeningPorts: new Set(),
};
const inspect = extra => assessNativeInstallEvidence({ ...base, ...extra });

test('clean Ubuntu 24.04 on amd64 and arm64 is only plannable, never installable', () => {
  for (const arch of ['x64', 'arm64']) {
    const result = inspect({host:{...host,arch}});
    assert.deepEqual(result.blockers, []);
    assert.equal(result.planCanProceed, true);
    assert.equal(result.installationAllowed, false);
    assert.equal(result.installed, false);
    assert.equal(result.hostModified, false);
    assert.equal(result.gate, 'D-53');
    assert.equal(result.portObservation, 'not_observed_in_listen_snapshot');
    assert.equal(result.portAvailabilityGuaranteed, false);
    assert.equal(result.serviceCredentialsVerified, false);
  }
});

test('Linux kernel TCP snapshots expose only LISTEN ports, both protocols', () => {
  const ipv4 = [
    '  sl  local_address rem_address   st tx_queue rx_queue',
    '   0: 00000000:228C 00000000:0000 0A 00000000:00000000',
    '   1: 0100007F:1770 00000000:0000 01 00000000:00000000',
  ].join('\n');
  const ipv6 = [
    '  sl  local_address rem_address   st tx_queue rx_queue',
    '   0: 00000000000000000000000000000000:22B0 00000000000000000000000000000000:0000 0A 00000000:00000000',
  ].join('\n');
  assert.deepEqual([...parseProcTcpListeningPorts(ipv4)], [8844]);
  assert.deepEqual([...parseProcTcpListeningPorts(ipv6)], [8880]);
  assert.equal(inspect({ipv4ListeningPorts:parseProcTcpListeningPorts(ipv4)}).portObservation,'occupied');
  assert.equal(inspect({ipv6ListeningPorts:new Set([8844])}).portObservation,'occupied');
  assert.ok(inspect({ipv4ListeningPorts:new Set([8844])}).blockers.includes('native_port_occupied_at_inspection'));
});

test('unreadable /proc tables are NEVER mistaken for free ports', () => {
  for (const evidence of [
    {ipv4ListeningPorts:null},
    {ipv6ListeningPorts:null},
    {ipv4ListeningPorts:[8844]},
    {ipv6ListeningPorts:new Set([-1])},
  ]) {
    const result = inspect(evidence);
    assert.equal(result.planCanProceed,false);
    assert.equal(result.portObservation,'unknown');
    assert.ok(result.blockers.includes('native_tcp_snapshot_unverified'));
  }
});

test('invalid or malformed TCP snapshots are rejected without guessing', () => {
  for (const snapshot of [
    '0: garbage', '  0: 00000000:ZZZZ 00000000:0000 0A',
    '  0: 00000000:228C 00000000:0000 not-hex',
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) {
    assert.throws(() => parseProcTcpListeningPorts(snapshot), /tcp_snapshot_/);
  }
});

test('existing or unreadable Domyro paths are hard blockers, including unit files', () => {
  for (const [path, state, reason] of [
    ['/opt/domyro', 'present', 'native_target_already_exists'],
    ['/etc/domyro', 'unknown', 'native_target_uninspectable'],
    ['/etc/systemd/system/domyro.service','present','native_target_already_exists'],
  ]) {
    const result=inspect({pathStates:{...cleanPaths,[path]:state}});
    assert.equal(result.planCanProceed,false);
    assert.ok(result.blockers.includes(reason+':'+path));
  }
});

test('systemd, apt and systemctl must be verified; unsupported Ubuntu is blocked', () => {
  const result=inspect({
    host:{...host,versionId:'26.04'},
    tools:{aptGet:false,systemctl:false},
    systemdBooted:false,
  });
  assert.ok(result.blockers.includes('ubuntu_release_not_yet_tested'));
  assert.ok(result.blockers.includes('systemd_pid1_not_verified'));
  assert.ok(result.blockers.includes('native_tool_missing_or_unverified:aptGet'));
  assert.ok(result.blockers.includes('native_tool_missing_or_unverified:systemctl'));
  assert.equal(result.planCanProceed,false);
});

test('inadequate host resources and reserved/privileged ports block planning', () => {
  for (const port of [22,443,5432,1883,8883,1000,65536,NaN]) {
    const result=inspect({requestedPort:port});
    assert.ok(result.blockers.includes('native_requested_port_invalid'));
    assert.equal(result.inspectedPort,null);
  }
  const result=inspect({host:{...host,ramBytes:512,freeDiskBytes:500,cpuCount:1}});
  assert.ok(result.blockers.includes('insufficient_memory'));
  assert.ok(result.blockers.includes('insufficient_disk'));
  assert.ok(result.blockers.includes('insufficient_cpus'));
});

test('runtime below Node 22.12 is flagged for provisioning, not falsely approved', () => {
  for (const nodeVersion of ['20.19.0', '22.11.9', 'unknown']) {
    const result=inspect({nodeVersion});
    assert.equal(result.supportedNodeRuntimePresent,false);
    assert.ok(result.notices.includes('node_runtime_provisioning_required'));
    assert.equal(result.installationAllowed,false);
  }
  assert.equal(inspect({nodeVersion:'22.12.0'}).supportedNodeRuntimePresent,true);
  assert.equal(inspect({nodeVersion:'24.0.0'}).supportedNodeRuntimePresent,true);
});

test('untrusted path evidence and incomplete input cannot become installation authorization', () => {
  assert.throws(() => inspect({pathStates:{}}), /native_paths_evidence_invalid/);
  assert.throws(() => inspect({pathStates:{...cleanPaths,'/opt/domyro':'free'}}), /native_paths_evidence_invalid/);
  assert.throws(() => inspect({host:null}), /host is required/);
  assert.ok(Object.isFrozen(inspect()));
});
