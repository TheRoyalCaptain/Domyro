#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Recover an interrupted NATIVE (NO DOCKER) Domyro design-preview refresh.
# Never changes PostgreSQL data or schema; never removes unknown directories.
set -Eeuo pipefail
export LC_ALL=C
APP=/opt/domyro-preview-native
HISTORY=/opt/domyro-preview-native-history
LOCKROOT=/run/domyro-preview-native
JOURNAL="$HISTORY/.pending-refresh"
UNIT=domyro-preview-native
die(){ printf 'Domyro preview recovery REFUSED: %s\n' "$*" >&2;exit 86; }
[[ "$#" == 1 && "$1" == --recover-native-preview ]] ||
  die "usage: sudo bash scripts/native-preview-recover.sh --recover-native-preview"
[[ "$EUID" == 0 && ! -e /.dockerenv ]] ||
  die "requires native Ubuntu sudo, no containers"
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 &&
   -d /run/systemd/system ]] || die "Ubuntu 24.04 systemd host required"
for command in systemctl flock stat mv sync curl install rm;do
  command -v "$command" >/dev/null || die "missing dependency: $command"
done
[[ -d "$HISTORY" && ! -L "$HISTORY" &&
   "$(stat -c %U:%a "$HISTORY")" == root:700 ]] ||
  die "private release-history directory not recognized"
[[ ! -L "$LOCKROOT" ]] || die "unsafe lifecycle lock location"
install -d -o root -g root -m 0700 "$LOCKROOT"
[[ "$(stat -c %U:%a "$LOCKROOT")" == root:700 ]] ||
  die "lifecycle lock directory permissions incorrect"
exec 9>"$LOCKROOT/refresh.lock"
flock -n 9 || die "an installation, refresh or recovery is already running"
[[ -f "$JOURNAL" && ! -L "$JOURNAL" &&
   "$(stat -c %U:%a "$JOURNAL")" == root:600 ]] ||
  die "no safely recorded interrupted refresh"
mapfile -t lines < "$JOURNAL"
[[ "${#lines[@]}" == 1 ]] ||
  die "invalid interrupted-refresh journal"
TOKEN="${lines[0]}"
[[ "$TOKEN" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]{1,12}$ ]] ||
  die "unsafe interrupted-refresh token"
BACKUP="$HISTORY/$TOKEN"
REJECTED="$HISTORY/.rejected-$TOKEN"
[[ ! -e "$REJECTED" && ! -L "$REJECTED" ]] ||
  die "unknown rejected release is present; manual review required"
[[ ! -L "$APP" && ! -L "$BACKUP" ]] ||
  die "unrecognized release symlink; manual review required"
if [[ -e "$BACKUP" ]];then
  [[ -d "$BACKUP" && "$(stat -c %U "$BACKUP")" == root &&
     -f "$BACKUP/src/server.mjs" ]] ||
    die "previous release is missing or unsafe"
fi
if [[ -e "$APP" ]];then
  [[ -d "$APP" && "$(stat -c %U "$APP")" == root &&
     -f "$APP/src/server.mjs" ]] ||
    die "active release is unrecognized"
fi
[[ -d "$APP" || -d "$BACKUP" ]] ||
  die "both old and current release missing; cannot recover"
[[ "$(systemctl show --value -p User "$UNIT.service")" == "$UNIT" &&
   "$(systemctl show --value -p ProtectSystem "$UNIT.service")" == strict ]] ||
  die "service identity not the expected private preview"
# Durable journal means NO new version committed; restore the previous code.
# Missing backup means the interruption happened before moving the old code.
systemctl stop "$UNIT.service"
if [[ -d "$BACKUP" ]];then
  if [[ -d "$APP" ]];then
    mv -T -- "$APP" "$REJECTED"
    sync -f /opt
  fi
  mv -T -- "$BACKUP" "$APP"
  sync -f "$HISTORY"
  sync -f /opt
fi
systemctl start "$UNIT.service"
HEALTHY=0
for _ in $(seq 1 30);do
  if systemctl is-active --quiet "$UNIT.service" &&
     curl -fsS --max-time 2 http://127.0.0.1:8844/api/v1/health/live 2>/dev/null |
       grep -q '"status":"alive"';then
    HEALTHY=1;break
  fi
  sleep 1
done
[[ "$HEALTHY" == 1 ]] ||
  die "previous release could not restart: journal retained for manual recovery"
rm -- "$JOURNAL"
sync -f "$HISTORY"
printf 'Domyro native preview recovered: previous release active; data unchanged. D-53 CLOSED.\n'
