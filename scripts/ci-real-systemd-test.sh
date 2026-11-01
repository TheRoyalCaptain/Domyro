#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Disposable GitHub-hosted Ubuntu runner only. DO NOT run on owner equipment.
set -Eeuo pipefail
if [[ "$GITHUB_ACTIONS" != "true" || "$RUNNER_ENVIRONMENT" != "github-hosted" ||
      "$DOMYRO_CI_SYSTEMD_ALLOWED" != "1" || "$RUNNER_OS" != "Linux" ||
      -z "$GITHUB_RUN_ID" || -z "$GITHUB_WORKSPACE" ]]; then
  echo "Refusing to run outside an explicitly marked disposable hosted CI runner" >&2
  exit 90
fi
. /etc/os-release
if [[ "$(id -un)" != "runner" || "$VERSION_ID" != "24.04" ]]; then
  echo "Expected GitHub-hosted Ubuntu 24.04 runner account" >&2
  exit 91
fi
if [[ ! -d /run/systemd/system || ! -f "$GITHUB_WORKSPACE/src/server.mjs" ]]; then
  echo "systemd or Domyro source not available" >&2
  exit 92
fi
if [[ "$(realpath "$PWD")" != "$(realpath "$GITHUB_WORKSPACE")" ]]; then
  echo "Project must be current GitHub workspace" >&2
  exit 93
fi
NODE_BIN="$(command -v node)"
if [[ "$NODE_BIN" != /opt/hostedtoolcache/node/* && "$NODE_BIN" != /usr/bin/node ]]; then
  echo "Unapproved runner Node runtime path" >&2
  exit 94
fi
# Build a disposable signed developer source bundle and verify it BEFORE
# running it through real systemd. The test key is ephemeral, not official.
UNIT="domyro-ci-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
STAGING_BASE="$(mktemp -d "$GITHUB_WORKSPACE/.domyro-ci-signed-XXXXXX")"
cleanup() {
  sudo systemctl stop "$UNIT.service" >/dev/null 2>&1 || true
  sudo systemctl reset-failed "$UNIT.service" >/dev/null 2>&1 || true
  rm -f "/tmp/domyro-ci-ready-$GITHUB_RUN_ID"
  if [[ -n "$STAGING_BASE" && "$STAGING_BASE" == "$GITHUB_WORKSPACE"/.domyro-ci-signed-* ]]; then
    rm -rf -- "$STAGING_BASE"
  fi
}
trap cleanup EXIT
RELEASE_ROOT="$(node scripts/ci-stage-signed-source.mjs "$STAGING_BASE/release-store")"
[[ -f "$RELEASE_ROOT/src/server.mjs" && -f "$RELEASE_ROOT/package-lock.json" ]]
# The dependency install must not change any signed source files.
SOURCE_DIGESTS="$STAGING_BASE/source.sha256"
(
  cd "$RELEASE_ROOT"
  find src web -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum package.json package-lock.json
) > "$SOURCE_DIGESTS"
npm ci --prefix "$RELEASE_ROOT" --omit=dev --ignore-scripts --no-audit --no-fund
(
  cd "$RELEASE_ROOT"
  find src web -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum package.json package-lock.json
) | diff -u "$SOURCE_DIGESTS" -
PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
BASE="http://127.0.0.1:$PORT"
echo "Starting verified signed developer source via CI-only systemd unit $UNIT on loopback port $PORT"
sudo systemd-run --unit="$UNIT" --collect --quiet \
  --property="User=runner" \
  --property="WorkingDirectory=$RELEASE_ROOT" \
  --property="Environment=NODE_ENV=test DOMYRO_HOST=127.0.0.1 DOMYRO_PORT=$PORT" \
  --property="NoNewPrivileges=yes" \
  --property="PrivateTmp=yes" \
  --property="ProtectSystem=strict" \
  --property="ProtectHome=read-only" \
  --property="UMask=0077" \
  --property="Restart=on-failure" \
  --property="RestartSec=1" \
  "$NODE_BIN" "$RELEASE_ROOT/src/server.mjs"
assert_live() {
  local found=0
  for _ in $(seq 1 30); do
    if curl --silent --fail --max-time 2 "$BASE/api/v1/health/live" | grep -q '"status":"alive"'; then
      found=1
      break
    fi
    sleep 1
  done
  [[ "$found" == "1" ]] || { sudo journalctl -u "$UNIT.service" -n 30 --no-pager || true; return 1; }
  [[ "$(curl --silent --output "/tmp/domyro-ci-ready-$GITHUB_RUN_ID" --write-out '%{http_code}' --max-time 3 "$BASE/api/v1/health/ready")" == "503" ]]
  grep -q '"status":"not_ready"' "/tmp/domyro-ci-ready-$GITHUB_RUN_ID"
  curl --silent --fail "$BASE/api/v1/public/status" | grep -q '"productionReady":false'
  curl --silent --fail "$BASE/login" | grep -q 'Domyro'
}
assert_live
PID_BEFORE="$(sudo systemctl show --value --property MainPID "$UNIT.service")"
[[ "$PID_BEFORE" =~ ^[0-9]+$ && "$PID_BEFORE" != 0 ]]
sudo systemctl restart "$UNIT.service"
assert_live
PID_AFTER="$(sudo systemctl show --value --property MainPID "$UNIT.service")"
[[ "$PID_AFTER" =~ ^[0-9]+$ && "$PID_AFTER" != 0 && "$PID_AFTER" != "$PID_BEFORE" ]]
[[ "$(sudo systemctl show --value --property User "$UNIT.service")" == "runner" ]]
# A manual restart alone does not prove systemd will recover a crashed daemon.
# Kill ONLY the transient CI unit's main process, never a system service.
sudo systemctl kill --kill-whom=main --signal=SIGKILL "$UNIT.service"
RECOVERED_PID=""
for _ in $(seq 1 30); do
  CANDIDATE_PID="$(sudo systemctl show --value --property MainPID "$UNIT.service")"
  if [[ "$CANDIDATE_PID" =~ ^[0-9]+$ && "$CANDIDATE_PID" != 0 &&
        "$CANDIDATE_PID" != "$PID_AFTER" ]] &&
     curl --silent --fail --max-time 2 "$BASE/api/v1/health/live" | grep -q '"status":"alive"'; then
    RECOVERED_PID="$CANDIDATE_PID"
    break
  fi
  sleep 1
done
if [[ -z "$RECOVERED_PID" ]]; then
  sudo journalctl -u "$UNIT.service" -n 50 --no-pager || true
  echo "systemd did not automatically recover after the CI-only process crash" >&2
  exit 1
fi
assert_live
RESTARTS="$(sudo systemctl show --value --property NRestarts "$UNIT.service")"
[[ "$RESTARTS" =~ ^[0-9]+$ && "$RESTARTS" -ge 1 ]]
echo "CI-only SIGNED source systemd start, manual restart and crash recovery verified. Not a production installation."
