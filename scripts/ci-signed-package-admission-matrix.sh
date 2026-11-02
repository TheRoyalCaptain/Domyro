#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# CI-only detached Ed25519 package admission, no privileged host writes.
set -eo pipefail
if [[ "$GITHUB_ACTIONS" != true ||
      "$RUNNER_ENVIRONMENT" != github-hosted ||
      "$RUNNER_OS" != Linux ||
      "$DOMYRO_CI_SYSTEMD_ALLOWED" != 1 ||
      "$DOMYRO_CI_SIGNED_ADMISSION_MATRIX" != 1 ||
      "$USER" != runner || "$(id -un)" != runner ||
      ! "$GITHUB_RUN_ID" =~ ^[0-9]+$ ||
      ! "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ||
      "$GITHUB_WORKSPACE" != /home/runner/work/* ||
      "$(realpath "$PWD")" != "$(realpath "$GITHUB_WORKSPACE")" ]]; then
  echo "Refusing signed admission test outside disposable hosted CI" >&2
  exit 90
fi
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ||
      ! -f scripts/ci-stage-signed-source.mjs ]]; then
  echo "Refusing signed admission test: unverified Ubuntu runner" >&2
  exit 91
fi
BASE="$(mktemp -d "$GITHUB_WORKSPACE/.domyro-ci-signed-XXXXXX")"
cleanup() { rm -rf -- "$BASE"; }
trap cleanup EXIT
for mode in clean artifact signature extra; do
  target="$BASE/$mode"
  mkdir -m 0700 "$target"
  # The nested release store MUST live under the test-exclusive run directory
  # whose basename begins ".domyro-ci-signed-", per the signer guard.
  # Use a separate top-level workspace scratch directory for every scenario.
  scratch="$(mktemp -d "$GITHUB_WORKSPACE/.domyro-ci-signed-XXXXXX")"
  if [[ "$mode" == clean ]]; then
    if ! node scripts/ci-stage-signed-source.mjs "$scratch/release-store" > "$target/verified-path"; then
      echo "Legitimate detached signed release failed admission" >&2
      rm -rf -- "$scratch"
      exit 92
    fi
    release="$(cat "$target/verified-path")"
    [[ "$release" == "$scratch/release-store/releases/0.1.1" && -f "$release/src/server.mjs" ]] || exit 93
    [[ -f "$scratch/offline-signed-package/release-manifest.sig" ]] || exit 93
    echo "Clean signed native package admitted and source reverified: $mode"
  else
    if DOMYRO_CI_SIGNED_PACKAGE_FAULT="$mode" \
      node scripts/ci-stage-signed-source.mjs "$scratch/release-store" > "$target/output" 2>&1; then
      echo "Tampered signed release was wrongly accepted: $mode" >&2
      rm -rf -- "$scratch"
      exit 94
    fi
    if [[ -e "$scratch/release-store/releases/0.1.1" ]]; then
      echo "Tampered signed release was staged after rejection: $mode" >&2
      rm -rf -- "$scratch"
      exit 95
    fi
    echo "Tampered signed native package safely refused: $mode"
  fi
  rm -rf -- "$scratch"
done
echo "Detached signed package admission: accepted original, refused 3 tamper variants; D-53 CLOSED."
