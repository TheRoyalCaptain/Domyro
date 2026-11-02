#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Manual NATIVE preview refresh ONLY. No Docker. No DB migrations/rewrites.
# Existing native preview only; refuse unsigned official release/production use.
set -Eeuo pipefail
export LC_ALL=C
UNIT=domyro-preview-native
APP=/opt/domyro-preview-native
CONF=/etc/domyro-preview-native
HISTORY=/opt/domyro-preview-native-history
LOCKROOT=/run/domyro-preview-native
STAGE=""
BACKUP=""
SWAPPED=0
log(){ printf 'Domyro native refresh: %s\n' "$*"; }
die(){ log "REFUSED: $*" >&2;exit 86; }
need(){ command -v "$1" >/dev/null 2>&1 || die "missing executable: $1"; }
[[ "$#" == 1 && "$1" == --refresh-native-preview ]] ||
  die "usage: sudo bash scripts/native-preview-refresh.sh --refresh-native-preview"
[[ "$EUID" == 0 && ! -e /.dockerenv ]] || die "native Ubuntu sudo only; not Docker"
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 && -d /run/systemd/system ]] ||
  die "Ubuntu 24.04 systemd host required"
for cmd in node npm systemctl flock install realpath cp chown chmod curl find stat;do need "$cmd";done
[[ -d "$APP" && ! -L "$APP" && -f "$APP/src/server.mjs" &&
   -d "$CONF" && ! -L "$CONF" &&
   -f "$CONF/migration.env" && ! -L "$CONF/migration.env" &&
   -f /etc/systemd/system/"$UNIT".service &&
   ! -L /etc/systemd/system/"$UNIT".service ]] ||
  die "existing native preview installation required; do not update unknown apps"
[[ "$(stat -c %U "$APP")" == root &&
   "$(stat -c %U "$CONF")" == root &&
   "$(stat -c %a "$CONF")" == 700 &&
   "$(stat -c %a "$CONF/migration.env")" == 600 ]] ||
  die "existing file ownership or permissions unsafe"
[[ "$(systemctl show --value -p User "$UNIT.service")" == "$UNIT" &&
   "$(systemctl show --value -p ProtectSystem "$UNIT.service")" == strict ]] ||
  die "service identity or hardening mismatch"
[[ "$(realpath "$PWD")" == "$PWD" && -f scripts/native-preview-refresh.sh &&
   "$(realpath -e scripts/native-preview-refresh.sh)" == "$PWD/scripts/native-preview-refresh.sh" &&
   -d node_modules/pg && -d node_modules/@node-rs/argon2 &&
   -f package-lock.json && -d src && -d web && -d scripts ]] ||
  die "refresh from a checked-out Domyro repository with npm ci --omit=dev completed"
[[ -z "$(find src web scripts -type l -print -quit)" ]] ||
  die "symlink in candidate source tree"
[[ ! -L "$LOCKROOT" && ! -L "$HISTORY" ]] ||
  die "unexpected symlink in private lifecycle state"
install -d -o root -g root -m 0700 "$LOCKROOT" "$HISTORY"
[[ "$(stat -c %a "$HISTORY")" == 700 &&
   "$(stat -c %U "$HISTORY")" == root ]] ||
  die "private release history unsafe"
exec 9>"$LOCKROOT/refresh.lock"
flock -n 9 || die "native preview refresh already running"
NOW="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STAGE="/opt/.domyro-preview-native-stage-$NOW"
BACKUP="$HISTORY/$NOW"
[[ ! -e "$STAGE" && ! -L "$STAGE" && ! -e "$BACKUP" && ! -L "$BACKUP" ]] ||
  die "candidate or history collision"
install -d -o root -g root -m 0755 "$STAGE"
cp -a -- src web scripts node_modules package.json package-lock.json "$STAGE/"
chown -R root:root "$STAGE"
chmod -R go-w "$STAGE"
node --check "$STAGE/src/server.mjs"
node --check "$STAGE/web/assets/login.js"
node --check "$STAGE/web/assets/app.js"
# A new schema requires a separately reviewed migration+backup process;
# this refresh only accepts the ALREADY-MIGRATED database.
set -a
# shellcheck disable=SC1091
source "$CONF/migration.env"
set +a
(
  cd "$STAGE"
  node scripts/migrate-db.mjs --check >/dev/null
) || die "schema changed, absent or incompatible; refusing to touch service"
unset DOMYRO_DATABASE_URL
rollback(){
  local code="$1"
  trap - ERR
  if [[ "$SWAPPED" == 1 || -d "$BACKUP" ]];then
    log "Health/restart failed; restoring the old release directory."
    systemctl stop "$UNIT.service" >/dev/null 2>&1 || true
    if [[ -d "$APP" ]];then mv -- "$APP" "$STAGE.rejected" || true;fi
    if [[ -d "$BACKUP" ]];then mv -- "$BACKUP" "$APP" || true;fi
    systemctl start "$UNIT.service" >/dev/null 2>&1 || true
    log "Rollback attempted; inspect systemctl status $UNIT"
  fi
  exit "$code"
}
trap 'rollback $?' ERR
log "Verified candidate and matching database schema. Restarting native preview."
systemctl stop "$UNIT.service"
mv -- "$APP" "$BACKUP"
mv -- "$STAGE" "$APP"
SWAPPED=1
systemctl start "$UNIT.service"
LIVE=0
for _ in $(seq 1 30);do
  if curl -fsS --max-time 2 http://127.0.0.1:8844/api/v1/health/live 2>/dev/null |
    grep -q '"status":"alive"';then LIVE=1;break;fi
  sleep 1
done
[[ "$LIVE" == 1 ]] || { log "New preview failed health check";false; }
[[ "$(systemctl is-active "$UNIT.service")" == active ]]
SWAPPED=0
trap - ERR
log "UPDATED: native preview running with preserved PostgreSQL; prior release saved at $BACKUP"
log "This does NOT install official signed updates or open D-53."
