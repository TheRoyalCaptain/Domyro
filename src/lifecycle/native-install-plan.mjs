// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure native Ubuntu installer planning and systemd draft rendering ONLY.
 * No host writes, package installs, service restarts or production approval.
 */
import { assessUbuntuHost } from './native-preflight.mjs';

const MODES = Object.freeze({
  postgresql: new Set(['managed','existing']),
  mqtt: new Set(['managed','existing','defer']),
  zigbee2mqtt: new Set(['existing','defer']),
  matter: new Set(['managed','existing','defer']),
});
const RESERVED = new Set([22,80,443,5432,1883,8883]);
const TESTED_OS = new Set(['24.04']);
const validPort = p => Number.isSafeInteger(p) && p >= 1024 && p <= 65535 && !RESERVED.has(p);

export function assessNativeInstallPlan({host, choices={}, port=8844, existingServices={}}={}) {
  const eligibility=assessUbuntuHost(host);
  const blockers=[...eligibility.blockers];
  if(host.osId==='ubuntu'&&!TESTED_OS.has(host.versionId))blockers.push('ubuntu_release_not_yet_tested');
  if(!validPort(port))blockers.push('invalid_or_reserved_port');
  if(!choices||typeof choices!=='object'||Array.isArray(choices)){
    blockers.push('invalid_service_choices');choices={};
  }
  if(!existingServices||typeof existingServices!=='object'||Array.isArray(existingServices)){
    blockers.push('invalid_existing_service_checks');existingServices={};
  }
  const services={};
  for(const [name,modes] of Object.entries(MODES)){
    const choice=choices[name];
    if(choice===undefined||choice===null){
      blockers.push(name+'_choice_required');services[name]=null;continue;
    }
    if(!modes.has(choice)||typeof choice!=='string'){
      blockers.push(name+'_choice_invalid');services[name]=null;continue;
    }
    services[name]=choice;
    if(choice==='existing'&&existingServices[name]?.verified!==true)blockers.push(name+'_existing_connection_unverified');
    if(choice==='managed')blockers.push(name+'_managed_service_unimplemented');
  }
  if(services.postgresql===null)blockers.push('postgresql_required_for_installation');
  if(host.hasExistingDomyro===true)blockers.push('existing_install_requires_update_or_repair');
  const steps=Object.freeze([
    'verify_signed_release','create_dedicated_system_user',
    'prepare_private_directories','configure_selected_services',
    'configure_local_tls_and_bootstrap','install_systemd_service',
    'health_and_recovery_validation',
  ].map(id=>Object.freeze({id,implemented:false})));
  return Object.freeze({
    environmentCanBePlanned:blockers.length===0,
    installationAllowed:false,codeReady:false,gate:'D-53',
    os:host.osId,version:host.versionId,arch:eligibility.mappedArchitecture,
    port:validPort(port)?port:null,services:Object.freeze(services),
    blockers:Object.freeze([...new Set(blockers)]),
    steps,hostSideEffects:false,requiresOwnerApprovalBeforeDeployment:true,
  });
}

export function renderNativeSystemdDraft({port=8844}={}){
  if(!validPort(port))throw new TypeError('invalid_native_systemd_port');
  return [
    '[Unit]',
    'Description=Domyro native service DRAFT (NOT production)',
    'After=network-online.target postgresql.service',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    'User=domyro',
    'Group=domyro',
    'WorkingDirectory=/opt/domyro/current',
    'ExecStart=/usr/bin/node /opt/domyro/current/src/server.mjs',
    'Environment=DOMYRO_HOST=127.0.0.1',
    'Environment=DOMYRO_PORT='+port,
    'EnvironmentFile=-/etc/domyro/development.env',
    'Restart=on-failure',
    'RestartSec=5',
    'NoNewPrivileges=yes',
    'CapabilityBoundingSet=',
    'AmbientCapabilities=',
    'RestrictSUIDSGID=yes',
    'LockPersonality=yes',
    'SystemCallArchitectures=native',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectControlGroups=yes',
    'ProtectClock=yes',
    'PrivateTmp=yes',
    'ProtectHome=yes',
    'ProtectSystem=strict',
    'ReadWritePaths=/var/lib/domyro',
    'UMask=0077',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}
