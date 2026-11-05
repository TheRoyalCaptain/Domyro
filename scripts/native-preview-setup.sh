#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# One-command convenience for a NATIVE Ubuntu 24.04 DESIGN PREVIEW.
# Run from reviewed source: bash scripts/native-preview-setup.sh --install-native-preview
# NOT the signed one-line production installer. NEVER Docker.
set -Eeuo pipefail
export LC_ALL=C
failure(){ printf 'Domyro native preview setup REFUSED: %s\n' "$*" >&2;exit 86; }
say(){ printf 'Domyro native preview setup: %s\n' "$*"; }
[[ "$#" == 1 && "$1" == --install-native-preview ]] ||
  failure 'usage: bash scripts/native-preview-setup.sh --install-native-preview'
[[ "$EUID" != 0 && -z "${SUDO_USER:-}" ]] ||
  failure 'run as your ordinary SSH account, not root/sudo'
[[ ! -e /.dockerenv && -f /etc/os-release ]] ||
  failure 'native Ubuntu host required, not Docker'
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 &&
   -d /run/systemd/system ]] ||
  failure 'requires Ubuntu 24.04 LTS with native systemd'
for executable in node npm sudo git bash realpath getent systemctl;do
  command -v "$executable" >/dev/null 2>&1 ||
    failure "missing prerequisite: $executable"
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))process.exit(1)' ||
  failure 'install a verified native Node.js 22.12+ runtime before continuing'
[[ "$(node -p 'require("./package.json").name')" == domyro &&
   -f scripts/native-preview-install.sh &&
   -f package-lock.json && -d src && -d web && -d scripts ]] ||
  failure 'run from a reviewed Domyro source checkout'
[[ "$(realpath "$PWD")" == "$PWD" &&
   "$(realpath -e scripts/native-preview-setup.sh)" == "$PWD/scripts/native-preview-setup.sh" &&
   "$(git rev-parse --show-toplevel)" == "$PWD" ]] ||
  failure 'source checkout must be a genuine non-symlink Git repository root'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  failure 'source checkout contains local modifications; review before install'
[[ ! -e /etc/domyro-preview-native && ! -L /etc/domyro-preview-native &&
   ! -e /opt/domyro-preview-native && ! -L /opt/domyro-preview-native &&
   ! -e /etc/systemd/system/domyro-preview-native.service &&
   ! -L /etc/systemd/system/domyro-preview-native.service ]] ||
  failure 'existing Domyro preview; never overwrite an installation'
! getent passwd domyro-preview-native >/dev/null ||
  failure 'existing preview service account; refusing fresh installation'
say 'Checking native Ubuntu prerequisites. This is NOT a production deployment.'
sudo -v || failure 'sudo authorization unavailable'
# Ubuntu test hosts may have psql CLIENT preinstalled without the server.
# Check the actual native server unit instead of mistaking client for server.
if [[ "$(systemctl show --value -p LoadState postgresql.service 2>/dev/null)" != loaded ]];then
  command -v apt-get >/dev/null 2>&1 ||
    failure 'native Ubuntu apt-get required'
  say 'Installing PostgreSQL from Ubuntu OS packages (NO Docker).'
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql postgresql-client
  sudo systemctl enable --now postgresql.service
else
  sudo systemctl is-active --quiet postgresql.service ||
    failure 'PostgreSQL exists but is stopped; investigate before changing services'
fi
say 'Installing exact locked JavaScript dependencies as the normal user.'
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
say 'Running the existing privileged native PostgreSQL/systemd installer.'
sudo bash scripts/native-preview-install.sh --install-native-preview
say 'Preview running. Read the random password with:'
say 'sudo cat /etc/domyro-preview-native/owner-password.txt'
say 'From a PC: ssh -L 8844:127.0.0.1:8844 USER@SERVER'
say 'D-53 remains closed. This is NOT the production installer or updater.'
