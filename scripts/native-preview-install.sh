#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# OPT-IN NATIVE UBUNTU 24.04 DESIGN PREVIEW. No Docker, no package install,
# no auto-upgrade, no existing-service takeover. NOT production-ready (D-53).
set -Eeuo pipefail
export LC_ALL=C
UNIT=domyro-preview-native
ROLE_MIGRATOR=domyro_preview_native_migrator
ROLE_RUNTIME=domyro_preview_native_app
DATABASE=domyro_preview_native
INSTALL=/opt/domyro-preview-native
CONF=/etc/domyro-preview-native
UNIT_FILE=/etc/systemd/system/domyro-preview-native.service
PORT=8844
log(){ printf 'Domyro native preview: %s\n' "$*"; }
die(){ log "REFUSED: $*" >&2; exit 86; }
need(){ command -v "$1" >/dev/null 2>&1 || die "missing native executable: $1"; }
preflight(){
  [[ "$EUID" == 0 ]] || die "requires sudo; no changes made"
  [[ ! -e /.dockerenv ]] || die "must run on a native Ubuntu host, not a container"
  . /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die "Ubuntu 24.04 LTS required"
  [[ -d /run/systemd/system ]] || die "systemd PID 1 required"
  for x in node npm psql runuser systemctl systemd-analyze install find cp chown chmod curl awk useradd sed grep;do need "$x";done
  NODE_BIN="$(command -v node)"
  [[ "$NODE_BIN" == /usr/bin/node || "$NODE_BIN" == /usr/local/bin/node ||
     "$NODE_BIN" == /opt/node/bin/node || "$NODE_BIN" == /opt/hostedtoolcache/node/* ]] ||
    die "unapproved Node executable path"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)' ||
    die "Node.js 22.12 or newer required"
  [[ -f package.json && -d src && -d web && -d scripts &&
     -d node_modules/pg && -d node_modules/@node-rs/argon2 &&
     -f scripts/migrate-db.mjs && -f scripts/bootstrap-owner.mjs ]] ||
    die "run npm ci --omit=dev --ignore-scripts --no-audit --no-fund as a normal user first"
  node -e 'if(require("./package.json").name!=="domyro")process.exit(1)' ||
    die "run from the Domyro source directory"
  [[ "$(realpath "$PWD")" == "$PWD" ]] || die "source directory is a symlink"
  [[ "$(realpath -e scripts/native-preview-install.sh)" == "$PWD/scripts/native-preview-install.sh" ]] ||
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
[[ "$#" == 1 && "$1" == --install-native-preview ]] ||
  die "usage: sudo bash scripts/native-preview-install.sh --install-native-preview"
preflight
# Generate separate one-time, random credentials. No secrets in argv/log/git.
MIG_PASS="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("hex"))')"
APP_PASS="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("hex"))')"
OWNER_PASS="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("base64url"))')"
umask 077
log "Preflight passed. Creating an independent native preview DB."
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
cp -a -- src web scripts node_modules package.json package-lock.json "$INSTALL/"
chown -R root:root "$INSTALL"
chmod -R go-w "$INSTALL"
printf 'DOMYRO_DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' \
  "$ROLE_MIGRATOR" "$MIG_PASS" "$DATABASE" > "$CONF/migration.env"
printf 'DOMYRO_HOST=127.0.0.1\nDOMYRO_PORT=8844\nDOMYRO_DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' \
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
  node scripts/bootstrap-owner.mjs --login native_preview_owner \
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
      if(x.u!=="domyro_preview_native_app"||x.can_create||x.can_schema)process.exitCode=1;
    }).catch(()=>{process.exitCode=1}).finally(()=>p.end());
  ' "$INSTALL" || die "restricted runtime DB role validation failed"
useradd --system --user-group --no-create-home --home-dir /nonexistent \
  --shell /usr/sbin/nologin "$UNIT"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Domyro NATIVE design preview (not production)
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
log "Login: native_preview_owner; password: sudo cat $CONF/owner-password.txt"
log "Access from PC: ssh -L 8844:127.0.0.1:8844 user@server"
log "D-53 CLOSED: not a production installer, device controller or in-app updater."
