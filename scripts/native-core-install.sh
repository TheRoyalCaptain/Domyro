#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Install a previously verified, explicitly approved native source release.
# Invoked by install-native-source.mjs. Never overwrites an existing install.
set -Eeuo pipefail
export LC_ALL=C
UNIT=domyro
ROLE_MIGRATOR=domyro_migrator
ROLE_RUNTIME=domyro_app
DATABASE=domyro
INSTALL=/opt/domyro
CONF=/etc/domyro
UNIT_FILE=/etc/systemd/system/domyro.service
PORT=8844
log(){ printf 'Domyro native installation: %s\n' "$*"; }
die(){ log "REFUSED: $*" >&2; exit 86; }
need(){ command -v "$1" >/dev/null 2>&1 || die "missing native executable: $1"; }
preflight(){
  [[ "$EUID" == 0 ]] || die "requires sudo; no changes made"
  [[ ! -e /.dockerenv ]] || die "must run on a native Ubuntu host, not a container"
  . /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die "Ubuntu 24.04 LTS required"
  [[ -d /run/systemd/system ]] || die "systemd PID 1 required"
  for x in node npm flock psql runuser systemctl systemd-analyze install find cp chown chmod curl awk useradd sed grep;do need "$x";done
  NODE_BIN="$(command -v node)"
  [[ "$NODE_BIN" == /usr/bin/node || "$NODE_BIN" == /usr/local/bin/node ||
     "$NODE_BIN" == /opt/node/bin/node || "$NODE_BIN" == /opt/hostedtoolcache/node/* ]] ||
    die "unapproved Node executable path"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)' ||
    die "Node.js 22.12 or newer required"
  [[ -f package.json && -d src && -d web && -d scripts &&
     -f scripts/migrate-db.mjs && -f scripts/bootstrap-owner.mjs ]] ||
    die "verified source is incomplete"
  node -e 'if(require("./package.json").name!=="domyro")process.exit(1)' ||
    die "run from the Domyro source directory"
  [[ "$(realpath "$PWD")" == "$PWD" ]] || die "source directory is a symlink"
  [[ "$(realpath -e scripts/native-core-install.sh)" == "$PWD/scripts/native-core-install.sh" ]] ||
    die "unexpected script path"
  local pg_major
  pg_major="$(runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 -d postgres \
    -c 'SHOW server_version_num' | awk '{print int($1/10000)}')" ||
    die "native PostgreSQL not running"
  [[ "$pg_major" =~ ^[0-9]+$ && "$pg_major" -ge 16 ]] ||
    die "native PostgreSQL 16+ required"
  [[ ! -e "$INSTALL" && ! -L "$INSTALL" && ! -e "$CONF" && ! -L "$CONF" &&
     ! -e "$UNIT_FILE" && ! -L "$UNIT_FILE" ]] ||
    die "existing installation files; refusing to overwrite"
  for path in /etc/domyro-updater /usr/lib/domyro-updater /var/lib/domyro-updater /etc/systemd/system/domyro-updater.service; do
    [[ ! -e "$path" && ! -L "$path" ]] || die "existing updater resources; refusing overwrite"
  done
  ! getent passwd "$UNIT" >/dev/null || die "existing service account"
  local exists
  exists="$(runuser -u postgres -- psql -X -qAt -v ON_ERROR_STOP=1 -d postgres -c \
    "SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN ('$ROLE_MIGRATOR','$ROLE_RUNTIME')) +
      (SELECT count(*) FROM pg_database WHERE datname='$DATABASE')")" ||
    die "could not verify DB/role collisions"
  [[ "$exists" == 0 ]] || die "existing preview database or roles; refusing"
  ! systemctl list-unit-files --no-legend "$UNIT.service" 2>/dev/null |
    grep -q "^$UNIT.service" || die "existing systemd unit"
  ! (exec 4<>/dev/tcp/127.0.0.1/8844) 2>/dev/null ||
    die "port 8844 already occupied"
  [[ -z "$(find src web scripts -type l -print -quit)" ]] ||
    die "symlink in privileged source tree"
  systemctl is-active --quiet postgresql.service ||
    die "native PostgreSQL service not active"
}
[[ "$#" == 1 && "$1" == --install-verified-core ]] ||
  die "usage: sudo bash scripts/native-core-install.sh --install-verified-core"
preflight
# The independently pinned policy and readiness were copied by the verified
# package entry point. Reverify the immutable source before any host mutation.
node --input-type=module <<'JS'
import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assessOwnerInstallationGate} from './scripts/check-installation-gate.mjs';
import {validatePublisherTrustPolicy} from './src/lifecycle/publisher-trust-policy.mjs';
import {inspectVerifiedStagedBundle} from './src/lifecycle/transactional-release.mjs';
const base='/var/lib/domyro-first-install/authority';
async function load(name){const path=base+'/'+name,s=await lstat(path);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)!==0)throw Error('unsafe_install_authority');
 return JSON.parse(await readFile(path,'utf8'));}
if(!assessOwnerInstallationGate(await load('installation-readiness.json')).ready)throw Error('installation_gate_closed');
const policy=await load('publisher.json');validatePublisherTrustPolicy({policy});
const version=JSON.parse(await readFile('package.json','utf8')).version;
await inspectVerifiedStagedBundle({root:resolve('../..'),version,
 trustedPublicKeyPem:policy.publicKeyPem,expectedArch:{x64:'amd64',arm64:'arm64'}[process.arch]});
JS
# A durable phase marker is evidence for explicit recovery, never permission
# to remove a database or retry over an existing/partially initialized host.
PHASE_FILE=/var/lib/domyro-first-install/phase
phase(){
  printf '%s\n' "$1" > "$PHASE_FILE.tmp"
  chmod 0600 "$PHASE_FILE.tmp"
  sync -f "$PHASE_FILE.tmp"
  mv -T "$PHASE_FILE.tmp" "$PHASE_FILE"
  sync -f /var/lib/domyro-first-install
}
trap 'printf "Installation interrupted. Existing data and private credentials were preserved; phase: %s\n" "$(cat "$PHASE_FILE" 2>/dev/null || true)" >&2' ERR
phase preparing_dependencies
useradd --system --user-group --no-create-home --home-dir /nonexistent \
  --shell /usr/sbin/nologin "$UNIT"
install -d -o "$UNIT" -g "$UNIT" -m 0700 "$INSTALL"
cp -a -- src web scripts package.json package-lock.json "$INSTALL/"
chown -R "$UNIT:$UNIT" "$INSTALL"
runuser -u "$UNIT" -- env "HOME=$INSTALL" bash -c \
  'cd /opt/domyro && exec npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache=/opt/domyro/.npm-cache'
rm -rf -- "$INSTALL/.npm-cache"
chown -R root:root "$INSTALL"
chmod -R go-w "$INSTALL"
# Confirm that npm did not change any signed source byte before privileged
# database setup loads migrations or the owner bootstrap.
node --input-type=module <<'JS'
import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
async function walk(dir=''){
 for(const e of await readdir(dir||'.',{withFileTypes:true})){
  if(!dir&&e.name==='.receipt.json')continue;
  const p=join(dir,e.name),dest=join('/opt/domyro',p),st=await lstat(dest);
  if(st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)throw Error('installed_source_unsafe');
  if(e.isDirectory()){if(!st.isDirectory())throw Error('installed_source_invalid');await walk(p);}
  else if(!st.isFile()||!(await readFile(p)).equals(await readFile(dest)))throw Error('installed_source_changed');
 }
}
await walk();
JS
chmod -R a+rX "$INSTALL"
phase configuring_database
# Generate separate one-time, random credentials. No secrets in argv/log/git.
MIG_PASS="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("hex"))')"
APP_PASS="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("hex"))')"
OWNER_PASS="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("base64url"))')"
umask 077
log "Preflight passed. Creating an independent native installation DB."
# Fixed SQL names, hex-only secrets, SQL sent over stdin rather than argv.
printf "CREATE ROLE %s LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '%s';\n" \
  "$ROLE_MIGRATOR" "$MIG_PASS" |
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres >/dev/null
printf "CREATE ROLE %s LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '%s';\n" \
  "$ROLE_RUNTIME" "$APP_PASS" |
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres >/dev/null
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres -c \
  "CREATE DATABASE $DATABASE OWNER $ROLE_MIGRATOR" >/dev/null
install -d -o root -g root -m 0700 "$CONF"
install -d -o root -g root -m 0755 "$INSTALL"
printf 'DOMYRO_DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' \
  "$ROLE_MIGRATOR" "$MIG_PASS" "$DATABASE" > "$CONF/migration.env"
printf 'DOMYRO_HOST=127.0.0.1\nDOMYRO_PORT=8844\nDOMYRO_UPDATE_SOCKET=/run/domyro-updater/control.sock\nDOMYRO_MAINTENANCE_FILE=/var/lib/domyro-updater/work/maintenance\nDOMYRO_DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' \
  "$ROLE_RUNTIME" "$APP_PASS" "$DATABASE" > "$CONF/runtime.env"
printf '%s\n' "$OWNER_PASS" > "$CONF/owner-password.txt"
chmod 0600 "$CONF/"*.env "$CONF/owner-password.txt"
unset MIG_PASS APP_PASS OWNER_PASS
set -a
# shellcheck disable=SC1091
source "$CONF/migration.env"
set +a
(
  cd "$INSTALL"
  node scripts/migrate-db.mjs --apply >/dev/null
  node scripts/migrate-db.mjs --check >/dev/null
  node scripts/bootstrap-owner.mjs --login owner \
    --site "Mijn woning" --password-file "$CONF/owner-password.txt" >/dev/null
)
unset DOMYRO_DATABASE_URL
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d "$DATABASE" \
  -c "GRANT CONNECT ON DATABASE $DATABASE TO $ROLE_RUNTIME;
      GRANT USAGE ON SCHEMA public TO $ROLE_RUNTIME;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO $ROLE_RUNTIME;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO $ROLE_RUNTIME;" >/dev/null
DOMYRO_DATABASE_URL="$(sed -n 's/^DOMYRO_DATABASE_URL=//p' "$CONF/runtime.env")" \
  "$NODE_BIN" -e '
    const {Pool}=require(process.argv[1]+"/node_modules/pg");
    const p=new Pool({connectionString:process.env.DOMYRO_DATABASE_URL});
    p.query("SELECT current_user AS u,has_database_privilege(current_user,current_database(),$1) AS can_create,has_schema_privilege(current_user,$2,$1) AS can_schema",["CREATE","public"]).then(r=>{
      const x=r.rows[0];
      if(x.u!=="domyro_app"||x.can_create||x.can_schema)process.exitCode=1;
    }).catch(()=>{process.exitCode=1}).finally(()=>p.end());
  ' "$INSTALL" || die "restricted runtime DB role validation failed"
phase installing_services
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Domyro native core
After=network-online.target postgresql.service
Requires=postgresql.service
[Service]
Type=exec
User=$UNIT
Group=$UNIT
WorkingDirectory=$INSTALL
ExecStart=$NODE_BIN $INSTALL/src/server.mjs
Environment=NODE_ENV=production
EnvironmentFile=$CONF/runtime.env
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallArchitectures=native
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$UNIT_FILE"
systemd-analyze verify "$UNIT_FILE" || die "invalid systemd unit"
install -d -o root -g root -m 0700 /etc/domyro-updater
cp /var/lib/domyro-first-install/authority/publisher.json /etc/domyro-updater/publisher.json
cp /var/lib/domyro-first-install/authority/installation-readiness.json /etc/domyro-updater/installation-readiness.json
cat > /etc/domyro-updater/worker.json <<'JSON'
{"schemaVersion":1,"managedIntegrations":[],"layout":{"app":"/opt/domyro","config":"/etc/domyro","work":"/var/lib/domyro-updater/work","unit":"domyro","database":"domyro","serviceUser":"domyro","port":8844}}
JSON
chmod 0600 /etc/domyro-updater/*.json
bash scripts/native-update-setup.sh --install-native-updater
systemctl daemon-reload
systemctl enable --now "$UNIT.service"
live=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/v1/health/live" 2>/dev/null |
     grep -q '"status":"alive"'; then live=1;break;fi
  sleep 1
done
[[ "$live" == 1 ]] || die "service not healthy; see journalctl -u $UNIT"
log "READY: native localhost portal http://127.0.0.1:$PORT"
log "Login: owner; password: sudo cat $CONF/owner-password.txt"
log "Access from PC: ssh -L 8844:127.0.0.1:8844 user@server"
# Verify the generated account and persistent site through the actual API.
node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
const base='http://127.0.0.1:8844';
const password=(await readFile('/etc/domyro/owner-password.txt','utf8')).trim();
const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},
 body:JSON.stringify({login:'owner',password}),signal:AbortSignal.timeout(5000)});
if(r.status!==200)throw Error('installed_owner_login_failed');
const cookie=r.headers.get('set-cookie')?.split(';')[0];
const sites=await fetch(base+'/api/v1/sites',{headers:{cookie},signal:AbortSignal.timeout(5000)});
if(sites.status!==200||(await sites.json()).sites?.length!==1)throw Error('installed_site_read_failed');
const updates=await fetch(base+'/api/v1/system/updates',{headers:{cookie},signal:AbortSignal.timeout(5000)});
if(updates.status!==200||(await updates.json()).workerAvailable!==true)throw Error('installed_updater_unavailable');
JS
phase installed
trap - ERR
log "Verified signed core, owner login, database and native update supervisor are running."
