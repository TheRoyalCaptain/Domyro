#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# CI-ONLY: prove that an INTERRUPTED first install cleans up a disposable VM.
# This MUST NEVER be run on an owner host or self-hosted GitHub runner.
set -Eeuo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true ||
      "${RUNNER_ENVIRONMENT:-}" != github-hosted ||
      "${RUNNER_OS:-}" != Linux ||
      "${DOMYRO_CI_SYSTEMD_ALLOWED:-}" != 1 ||
      "${DOMYRO_CI_PG_ONBOARDING:-}" != 1 ||
      "${DOMYRO_CI_FAULT_MATRIX:-}" != 1 ||
      "${DOMYRO_TEST_DATABASE_URL:-}" != 'postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test' ||
      ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ||
      ! "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ||
      "${USER:-}" != runner ||
      "$(id -un)" != runner ||
      -z "${GITHUB_WORKSPACE:-}" ]]; then
  echo "Refusing native installer fault matrix outside disposable hosted PostgreSQL CI" >&2
  exit 90
fi
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ||
      ! -d /run/systemd/system ||
      "$GITHUB_WORKSPACE" != /home/runner/work/* ||
      "$(realpath "$PWD")" != "$(realpath "$GITHUB_WORKSPACE")" ||
      ! -f "$GITHUB_WORKSPACE/scripts/ci-native-account-test.sh" ||
      -n "${DOMYRO_CI_FAILPOINT:-}" ]]; then
  echo "Refusing native installer fault matrix in unverified workspace" >&2
  exit 91
fi

SUFFIX="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
UNIT="domyro-ci-native-$SUFFIX"
SERVICE_USER="domyroci$GITHUB_RUN_ID"
DB_NAME="domyro_native_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
ROLE_NAME="domyro_app_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"

assert_cleaned() {
  local phase="$1"
  if id "$SERVICE_USER" >/dev/null 2>&1 ||
     sudo test -e "/opt/$UNIT" ||
     sudo test -e "/etc/$UNIT" ||
     sudo test -e "/var/lib/$UNIT" ||
     sudo test -e "/run/systemd/system/$UNIT.service" ||
     sudo systemctl is-active --quiet "$UNIT.service" ||
     compgen -G "$GITHUB_WORKSPACE/.domyro-ci-signed-*" >/dev/null; then
    echo "Installer failure left native host resources after $phase" >&2
    exit 93
  fi
  # The database AND separately credentialed application role must be gone.
  CI_DB_NAME="$DB_NAME" CI_RUNTIME_ROLE="$ROLE_NAME" node --input-type=module -e '
    import {Pool} from "pg";
    const db=new Pool({connectionString:process.env.DOMYRO_TEST_DATABASE_URL,max:1});
    try {
      const result=await db.query(
        "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS db_exists, " +
        "EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS role_exists",
        [process.env.CI_DB_NAME,process.env.CI_RUNTIME_ROLE]);
      if(result.rows[0].db_exists || result.rows[0].role_exists){
        process.stderr.write("Disposable PostgreSQL resources survived installer failure\\n");
        process.exitCode=94;
      }
    } finally {await db.end();}
  '
}

for point in after-db-bootstrap after-db-role after-unit-start after-restart; do
  echo "Testing expected installer failure at: $point"
  set +e
  DOMYRO_CI_FAILPOINT="$point" bash scripts/ci-native-account-test.sh
  outcome=$?
  set -e
  if [[ "$outcome" != 86 ]]; then
    echo "Unexpected installer failure outcome for $point: $outcome" >&2
    exit 92
  fi
  assert_cleaned "$point"
done

# A dangling symlink looks absent to `-e`, but must NEVER be followed or
# replaced by a first-install command. Prove this on the disposable CI runner.
INSTALL_ROOT="/opt/$UNIT"
STATE_ROOT="/var/lib/$UNIT"
assert_cleaned "before-existing-target-probes"
cleanup_refusal_probes() {
  if sudo test -L "$INSTALL_ROOT"; then sudo rm -- "$INSTALL_ROOT"; fi
  sudo rmdir -- "$STATE_ROOT" >/dev/null 2>&1 || true
}
trap cleanup_refusal_probes EXIT
assert_refused_untouched() {
  local stage="$1" output outcome
  set +e
  output="$(bash scripts/ci-native-account-test.sh 2>&1)"
  outcome=$?
  set -e
  if [[ "$outcome" != 93 || "$output" != *"refusing before changes"* ]]; then
    echo "Native installer did not reject occupied target during $stage: $outcome" >&2
    exit 95
  fi
}
sudo ln -s /etc/hosts "$INSTALL_ROOT"
assert_refused_untouched "dangling-target-symlink"
[[ "$(sudo readlink "$INSTALL_ROOT")" == "/etc/hosts" ]]
sudo rm -- "$INSTALL_ROOT"
assert_cleaned "after-symlink-refusal"

sudo install -d -m 0700 "$STATE_ROOT"
assert_refused_untouched "pre-existing-state-directory"
[[ "$(sudo stat -c %a "$STATE_ROOT")" == 700 ]]
sudo rmdir -- "$STATE_ROOT"
assert_cleaned "after-existing-state-refusal"
trap - EXIT

echo "Disposable native installer: 4 fault points, existing symlink/state refusals and cleanup verified. D-53 CLOSED."
