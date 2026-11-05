#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Install the independent privileged supervisor only after owner-managed trust
# and verified installation readiness have been provisioned. Never opens D-53.
set -Eeuo pipefail
export LC_ALL=C
die(){ printf 'Domyro updater setup refused: %s\n' "$*" >&2;exit 86; }
[[ "$#" == 1 && "$1" == --install-native-updater && "$EUID" == 0 ]] ||
  die 'usage: sudo bash scripts/native-update-setup.sh --install-native-updater'
[[ ! -e /.dockerenv && -d /run/systemd/system ]] || die 'native Ubuntu systemd required'
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die 'Ubuntu 24.04 required'
for cmd in node systemctl flock install cp chown chmod find;do command -v "$cmd" >/dev/null||die "missing $cmd";done
[[ -f scripts/native-update-worker.mjs && -f scripts/check-installation-gate.mjs &&
   -f src/lifecycle/native-update-host.mjs && -f package.json ]] || die 'run from reviewed source'
[[ -z "$(find src scripts -type l -print -quit)" ]] || die 'source contains symlinks'
NODE="$(command -v node)"
[[ "$NODE" == /usr/bin/node || "$NODE" == /usr/local/bin/node || "$NODE" == /opt/node/bin/node ]] ||
  die 'use a stable system Node.js path'
for path in /usr/lib/domyro-updater /var/lib/domyro-updater /etc/systemd/system/domyro-updater.service;do
  [[ ! -e "$path" && ! -L "$path" ]] || die 'updater files already exist; refusing overwrite'
done
# Configuration is provisioned separately. All three files are root-only;
# setup cannot invent consent, mark tests passed or create a signing identity.
SERVICE_USER="$(node --input-type=module <<'JS'
import {readFile,lstat} from 'node:fs/promises';
import {assessOwnerInstallationGate} from './scripts/check-installation-gate.mjs';
import {validatePublisherTrustPolicy} from './src/lifecycle/publisher-trust-policy.mjs';
const dir='/etc/domyro-updater',stat=await lstat(dir);
if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('unsafe_config_directory');
async function load(name){const path=dir+'/'+name;const s=await lstat(path);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)!==0||s.size>65536)throw Error('unsafe_config');
 return JSON.parse(await readFile(path,'utf8'));}
if(!assessOwnerInstallationGate(await load('installation-readiness.json')).ready)throw Error('D-53_closed');
validatePublisherTrustPolicy({policy:await load('publisher.json')});
const c=await load('worker.json');
if(c.schemaVersion!==1||c.managedIntegrations?.length!==0||
   c.layout?.work!=='/var/lib/domyro-updater/work'||
   !/^[a-z][a-z0-9-]{1,60}$/.test(c.layout?.serviceUser??''))throw Error('unsupported_layout');
console.log(c.layout.serviceUser);
JS
)" || die 'verified readiness, publisher or worker configuration missing'
getent passwd "$SERVICE_USER" >/dev/null || die 'existing core service account required'
install -d -o root -g root -m 0755 /usr/lib/domyro-updater
cp -a src package.json /usr/lib/domyro-updater/
install -d -o root -g root -m 0755 /usr/lib/domyro-updater/scripts
cp scripts/native-update-worker.mjs scripts/check-installation-gate.mjs /usr/lib/domyro-updater/scripts/
chown -R root:root /usr/lib/domyro-updater
chmod -R go-w /usr/lib/domyro-updater
install -d -o root -g root -m 0711 /var/lib/domyro-updater /var/lib/domyro-updater/work
install -d -o root -g root -m 0700 /var/lib/domyro-updater/state
cat > /etc/systemd/system/domyro-updater.service <<EOF
[Unit]
Description=Domyro signed native update and recovery supervisor
After=postgresql.service
Requires=postgresql.service
[Service]
Type=exec
User=root
Group=$SERVICE_USER
RuntimeDirectory=domyro-updater
RuntimeDirectoryMode=0750
RuntimeDirectoryPreserve=yes
WorkingDirectory=/usr/lib/domyro-updater
Environment=PATH=${NODE%/*}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/flock --nonblock /run/domyro-updater/worker.lock $NODE /usr/lib/domyro-updater/scripts/native-update-worker.mjs
Restart=on-failure
RestartSec=5
UMask=0077
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
TimeoutStopSec=360
[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /etc/systemd/system/domyro-updater.service
systemd-analyze verify /etc/systemd/system/domyro-updater.service
systemctl daemon-reload
systemctl enable --now domyro-updater.service
printf 'Supervisor installed. Add DOMYRO_UPDATE_SOCKET=/run/domyro-updater/control.sock and DOMYRO_MAINTENANCE_FILE=/var/lib/domyro-updater/work/maintenance to the core runtime configuration, then restart the core.\n'
