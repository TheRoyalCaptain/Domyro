#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Disposable GitHub-hosted Ubuntu ONLY: kill the first-install process, prove
# its running service and user data survive, refuse retry, explicitly clean up.
set -Eeuo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted ||
      "${RUNNER_OS:-}" != Linux || "${DOMYRO_CI_SYSTEMD_ALLOWED:-}" != 1 ||
      "${DOMYRO_CI_PG_ONBOARDING:-}" != 1 || "${DOMYRO_CI_FAULT_MATRIX:-}" != 1 ||
      "${DOMYRO_TEST_DATABASE_URL:-}" != 'postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test' ||
      "${USER:-}" != runner || "$(id -un)" != runner ||
      ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ || ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ||
      "${GITHUB_WORKSPACE:-}" != /home/runner/work/* ]]; then
  echo "Refusing native SIGKILL drill outside disposable hosted PostgreSQL CI" >&2
  exit 90
fi
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ||
      ! -d /run/systemd/system || "$(realpath "$PWD")" != "$(realpath "$GITHUB_WORKSPACE")" ||
      ! -f "$GITHUB_WORKSPACE/scripts/ci-native-account-test.sh" ]]; then
  echo "Refusing native SIGKILL drill in unverified workspace" >&2
  exit 91
fi
SUFFIX="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
UNIT="domyro-ci-native-$SUFFIX"
SERVICE_USER="domyroci$GITHUB_RUN_ID"
INSTALL_ROOT="/opt/$UNIT"
CONFIG_ROOT="/etc/$UNIT"
STATE_ROOT="/var/lib/$UNIT"
UNIT_FILE="/run/systemd/system/$UNIT.service"

# Only new, run-scoped resources may be removed in this test.
if id "$SERVICE_USER" >/dev/null 2>&1 ||
   [[ -e "$INSTALL_ROOT" || -L "$INSTALL_ROOT" || -e "$CONFIG_ROOT" || -L "$CONFIG_ROOT" ||
      -e "$STATE_ROOT" || -L "$STATE_ROOT" || -e "$UNIT_FILE" || -L "$UNIT_FILE" ]] ||
   compgen -G "$GITHUB_WORKSPACE/.domyro-ci-signed-*" >/dev/null; then
  echo "Pre-existing CI resources: refusing SIGKILL drill" >&2
  exit 92
fi

database() {
  DOMYRO_CI_CRASH_DB_PHASE="$1" node --input-type=module -e '
    import {Pool} from "pg";
    const id=process.env.GITHUB_RUN_ID, attempt=process.env.GITHUB_RUN_ATTEMPT;
    if(!/^[0-9]+$/.test(id)||!/^[0-9]+$/.test(attempt))process.exit(90);
    const name="domyro_native_"+id+"_"+attempt,role="domyro_app_"+id+"_"+attempt;
    const db=new Pool({connectionString:process.env.DOMYRO_TEST_DATABASE_URL,max:1});
    try{
      if(process.env.DOMYRO_CI_CRASH_DB_PHASE==="delete"){
        await db.query("DROP DATABASE IF EXISTS \""+name+"\" WITH (FORCE)");
        await db.query("DROP ROLE IF EXISTS \""+role+"\"");
      }else{
      const response=await db.query(
        "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS d, "+
        "EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS r",[name,role]);
      const exists=response.rows[0];
      if(process.env.DOMYRO_CI_CRASH_DB_PHASE==="absent"){
        if(exists.d||exists.r)throw Error("ci_db_not_clean");
      }else if(process.env.DOMYRO_CI_CRASH_DB_PHASE==="present"){
        if(!exists.d||!exists.r)throw Error("ci_db_not_preserved");
        const url=new URL(process.env.DOMYRO_TEST_DATABASE_URL);url.pathname="/"+name;
        const app=new Pool({connectionString:url.href,max:1});
        try{
          const counts=await app.query(
            "SELECT (SELECT count(*)::int FROM domyro_users) AS users, "+
            "(SELECT count(*)::int FROM domyro_areas) AS rooms");
          if(counts.rows[0].users!==1||counts.rows[0].rooms!==1)throw Error("ci_owner_data_lost");
        }finally{await app.end();}
      }else throw Error("ci_unknown_database_probe");
      }
    }finally{await db.end();}
  '
}
database absent
cleanup() {
  local original="$?"
  local cleanup_error=0
  trap - EXIT
  set +e
  sudo systemctl stop "$UNIT.service" >/dev/null 2>&1
  sudo systemctl reset-failed "$UNIT.service" >/dev/null 2>&1
  sudo rm -f -- "$UNIT_FILE"
  sudo systemctl daemon-reload >/dev/null 2>&1
  if id "$SERVICE_USER" >/dev/null 2>&1; then sudo userdel "$SERVICE_USER" || cleanup_error=1; fi
  sudo rm -rf -- "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT" || cleanup_error=1
  find "$GITHUB_WORKSPACE" -maxdepth 1 -mindepth 1 -type d \
    -name '.domyro-ci-signed-*' -print0 | xargs -0 -r rm -rf -- || cleanup_error=1
  database delete || cleanup_error=1
  database absent || cleanup_error=1
  if id "$SERVICE_USER" >/dev/null 2>&1 ||
     sudo test -e "$INSTALL_ROOT" || sudo test -e "$CONFIG_ROOT" ||
     sudo test -e "$STATE_ROOT" || sudo test -e "$UNIT_FILE" ||
     compgen -G "$GITHUB_WORKSPACE/.domyro-ci-signed-*" >/dev/null; then
    cleanup_error=1
  fi
  if [[ "$cleanup_error" != 0 ]]; then
    echo "Explicit disposable SIGKILL recovery failed" >&2
    exit 100
  fi
  exit "$original"
}
trap cleanup EXIT

# The nested installer is killed after first HTTP login, room creation and
# systemd startup. SIGKILL skips the installer's own EXIT trap.
CRASH_LOG="$(mktemp "$GITHUB_WORKSPACE/.domyro-ci-crash-XXXXXX")"
set +e
DOMYRO_CI_FAILPOINT=after-unit-start-sigkill \
  bash scripts/ci-native-account-test.sh >"$CRASH_LOG" 2>&1
CRASH_CODE="$?"
set -e
if [[ "$CRASH_CODE" != 137 ]]; then
  echo "Expected SIGKILL exit 137, got $CRASH_CODE" >&2
  tail -n 25 "$CRASH_LOG" | sed -E 's@postgresql://[^[:space:]]+@postgresql://[REDACTED]@g' >&2
  rm -f -- "$CRASH_LOG"
  exit 93
fi
rm -f -- "$CRASH_LOG"
id "$SERVICE_USER" >/dev/null 2>&1
[[ -f "$UNIT_FILE" && -d "$INSTALL_ROOT" && -d "$CONFIG_ROOT" ]]
sudo systemctl is-active --quiet "$UNIT.service"
database present
ENV_SHA="$(sudo sha256sum "$CONFIG_ROOT/development.env" | cut -d' ' -f1)"
UNIT_SHA="$(sudo sha256sum "$UNIT_FILE" | cut -d' ' -f1)"
PORT="$(sudo sed -n 's/^DOMYRO_PORT=//p' "$CONFIG_ROOT/development.env")"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]]
curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/v1/health/live" |
  grep -q '"status":"alive"'

# Rerun with the same identifier MUST return before creating its cleanup trap.
set +e
bash scripts/ci-native-account-test.sh >/dev/null 2>&1
RETRY_CODE="$?"
set -e
if [[ "$RETRY_CODE" != 93 ]]; then
  echo "Native install retry was not refused" >&2
  exit 94
fi
[[ "$(sudo sha256sum "$CONFIG_ROOT/development.env" | cut -d' ' -f1)" == "$ENV_SHA" ]]
[[ "$(sudo sha256sum "$UNIT_FILE" | cut -d' ' -f1)" == "$UNIT_SHA" ]]
sudo systemctl is-active --quiet "$UNIT.service"
database present
echo "SIGKILL installer drill: running service and owner data retained; reinstall refused. Explicit disposable cleanup follows."
