#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# CI-ONLY: disposable GitHub-hosted Ubuntu 24.04 VM. NEVER use on owner hosts.
# Dedicated nologin account, private state/config, root-owned release, real
# installed-but-not-enabled systemd unit, restart and crash recovery.
set -Eeuo pipefail
if [[ "$GITHUB_ACTIONS" != "true" ||
      "$RUNNER_ENVIRONMENT" != "github-hosted" ||
      "$DOMYRO_CI_SYSTEMD_ALLOWED" != "1" ||
      "$RUNNER_OS" != "Linux" ||
      ! "$GITHUB_RUN_ID" =~ ^[0-9]+$ ||
      ! "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ||
      -z "$GITHUB_WORKSPACE" ||
      "$(id -un)" != "runner" ]]; then
  echo "Refusing native account test outside explicitly marked disposable hosted CI" >&2
  exit 90
fi
. /etc/os-release
if [[ "$ID" != "ubuntu" || "$VERSION_ID" != "24.04" ||
      ! -d /run/systemd/system ||
      "$(realpath "$PWD")" != "$(realpath "$GITHUB_WORKSPACE")" ||
      "$GITHUB_WORKSPACE" != /home/runner/work/* ||
      ! -f "$GITHUB_WORKSPACE/src/server.mjs" ]]; then
  echo "Expected clean GitHub-hosted Ubuntu 24.04 workspace with systemd" >&2
  exit 91
fi
NODE_BIN="$(command -v node)"
if [[ "$NODE_BIN" != /opt/hostedtoolcache/node/* && "$NODE_BIN" != /usr/bin/node ]]; then
  echo "Unapproved Node executable path" >&2
  exit 92
fi
SUFFIX="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
UNIT="domyro-ci-native-$SUFFIX"
SERVICE_USER="domyroci$GITHUB_RUN_ID"
INSTALL_ROOT="/opt/$UNIT"
CONFIG_ROOT="/etc/$UNIT"
STATE_ROOT="/var/lib/$UNIT"
UNIT_FILE="/run/systemd/system/$UNIT.service"
STAGING_BASE="$(mktemp -d "$GITHUB_WORKSPACE/.domyro-ci-signed-XXXXXX")"
PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
BASE="http://127.0.0.1:$PORT"
cleanup() {
  sudo systemctl stop "$UNIT.service" >/dev/null 2>&1 || true
  sudo systemctl reset-failed "$UNIT.service" >/dev/null 2>&1 || true
  sudo rm -f -- "$UNIT_FILE"
  sudo systemctl daemon-reload >/dev/null 2>&1 || true
  if id "$SERVICE_USER" >/dev/null 2>&1; then sudo userdel "$SERVICE_USER" >/dev/null 2>&1 || true; fi
  sudo rm -rf -- "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT"
  rm -rf -- "$STAGING_BASE"
}
trap cleanup EXIT
if id "$SERVICE_USER" >/dev/null 2>&1 ||
   [[ -e "$INSTALL_ROOT" || -e "$CONFIG_ROOT" || -e "$STATE_ROOT" || -e "$UNIT_FILE" ]]; then
  echo "Unexpected pre-existing CI identity or paths; refusing to overwrite" >&2
  exit 93
fi
RELEASE_ROOT="$(node scripts/ci-stage-signed-source.mjs "$STAGING_BASE/release-store")"
[[ -f "$RELEASE_ROOT/src/server.mjs" && -f "$RELEASE_ROOT/package-lock.json" ]]
(
  cd "$RELEASE_ROOT"
  find src web -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum package.json package-lock.json
) > "$STAGING_BASE/signed-files.sha256"
npm ci --prefix "$RELEASE_ROOT" --omit=dev --ignore-scripts --no-audit --no-fund
(
  cd "$RELEASE_ROOT"
  find src web -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum package.json package-lock.json
) | diff -u "$STAGING_BASE/signed-files.sha256" -
# All privileged changes are confined to a disposable hosted CI VM.
sudo useradd --system --user-group --no-create-home \
  --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
sudo install -d -o root -g root -m 0755 "$INSTALL_ROOT"
sudo cp -a -- "$RELEASE_ROOT/." "$INSTALL_ROOT/"
sudo chown -R root:root "$INSTALL_ROOT"
sudo chmod -R go-w "$INSTALL_ROOT"
sudo chmod -R a+rX "$INSTALL_ROOT"
sudo install -d -o root -g root -m 0755 "$CONFIG_ROOT"
printf 'DOMYRO_HOST=127.0.0.1\nDOMYRO_PORT=%s\n' "$PORT" |
  sudo tee "$CONFIG_ROOT/development.env" >/dev/null
sudo chmod 0600 "$CONFIG_ROOT/development.env"
# systemd PID 1 reads the root-owned environment file, not the service user.
sudo tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=Domyro disposable native account integration (NOT production)
After=network-online.target
[Service]
Type=exec
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_ROOT
ExecStart=$NODE_BIN $INSTALL_ROOT/src/server.mjs
Environment=NODE_ENV=test
EnvironmentFile=$CONFIG_ROOT/development.env
StateDirectory=$UNIT
StateDirectoryMode=0700
Restart=on-failure
RestartSec=1
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
sudo chmod 0644 "$UNIT_FILE"
sudo systemd-analyze verify "$UNIT_FILE"
sudo systemctl daemon-reload
sudo systemctl start "$UNIT.service"
assert_live() {
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "$BASE/api/v1/health/live" 2>/dev/null |
      grep -q '"status":"alive"'; then ok=1; break; fi
    sleep 1
  done
  if [[ "$ok" != 1 ]]; then
    sudo journalctl -u "$UNIT.service" -n 40 --no-pager || true
    return 1
  fi
  local ready_code
  ready_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$BASE/api/v1/health/ready")"
  [[ "$ready_code" == 503 ]]
  curl -fsS --max-time 3 "$BASE/api/v1/public/status" |
    grep -q '"productionReady":false'
  curl -fsS --max-time 3 "$BASE/login" | grep -q 'Domyro'
}
assert_live
[[ "$(sudo systemctl show --value -p User "$UNIT.service")" == "$SERVICE_USER" ]]
[[ "$(sudo systemctl show --value -p Group "$UNIT.service")" == "$SERVICE_USER" ]]
[[ "$(sudo systemctl is-enabled "$UNIT.service")" == "disabled" ]]
[[ "$(getent passwd "$SERVICE_USER" | cut -d: -f7)" == "/usr/sbin/nologin" ]]
[[ "$(stat -c %U "$INSTALL_ROOT/src/server.mjs")" == "root" ]]
[[ "$(stat -c %a "$CONFIG_ROOT/development.env")" == 600 ]]
[[ "$(stat -c %U "$STATE_ROOT")" == "$SERVICE_USER" ]]
[[ "$(stat -c %a "$STATE_ROOT")" == 700 ]]
sudo -u "$SERVICE_USER" test -r "$INSTALL_ROOT/src/server.mjs"
if sudo -u "$SERVICE_USER" test -w "$INSTALL_ROOT/src/server.mjs"; then
  echo "Service user can modify installed release" >&2
  exit 94
fi
if sudo -u "$SERVICE_USER" test -r "$CONFIG_ROOT/development.env"; then
  echo "Service user can read root-only environment file" >&2
  exit 95
fi
sudo -u "$SERVICE_USER" test -w "$STATE_ROOT"
PID1="$(sudo systemctl show --value -p MainPID "$UNIT.service")"
[[ "$PID1" =~ ^[0-9]+$ && "$PID1" != 0 ]]
sudo systemctl restart "$UNIT.service"
assert_live
PID2="$(sudo systemctl show --value -p MainPID "$UNIT.service")"
[[ "$PID2" =~ ^[0-9]+$ && "$PID2" != 0 && "$PID2" != "$PID1" ]]
sudo systemctl kill --kill-whom=main --signal=SIGKILL "$UNIT.service"
RECOVERED=""
for _ in $(seq 1 30); do
  PID3="$(sudo systemctl show --value -p MainPID "$UNIT.service")"
  if [[ "$PID3" =~ ^[0-9]+$ && "$PID3" != 0 && "$PID3" != "$PID2" ]] &&
    curl -fsS --max-time 2 "$BASE/api/v1/health/live" 2>/dev/null |
      grep -q '"status":"alive"'; then
    RECOVERED="$PID3"; break
  fi
  sleep 1
done
[[ -n "$RECOVERED" ]]
assert_live
[[ "$(sudo systemctl show --value -p NRestarts "$UNIT.service")" -ge 1 ]]
echo "Disposable native account, root-owned source, private state/config, real unit, restart and crash recovery verified; D-53 CLOSED."
