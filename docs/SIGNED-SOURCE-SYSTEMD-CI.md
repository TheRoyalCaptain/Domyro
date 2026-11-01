# Signed development source running under real systemd (disposable CI)

**Milestone:** 2 November 2026  
**Status:** developer CI only; **D-53 remains CLOSED**. This is not an installable package, owner-server setup or a release.

**Project disclosure:** Domyro is developed using AI under the supervision of and in collaboration with [@TheRoyalCaptain](https://github.com/TheRoyalCaptain). Only the owner may authorize official deployment and release.

## End-to-end isolated path

The `native-systemd-integration.yml` GitHub Actions workflow runs on **fresh GitHub-hosted Ubuntu 24.04 AMD64 and ARM64**. The integration script `scripts/ci-real-systemd-test.sh` refuses execution unless it is running under the hosted `runner` account, with the CI opt-in marker and expected Ubuntu version.

The CI test now exercises a stronger path than directly launching the checkout:

1. `scripts/ci-stage-signed-source.mjs` generates an **ephemeral developer-only Ed25519 keypair** in memory, builds a signed source release with the current repository, verifies its signature and stages it under a private, newly created directory inside the disposable runner workspace. **The ephemeral test key is not an official release trust root.**
2. `npm ci --omit=dev --ignore-scripts` installs production dependencies from the committed integrity-locked lockfile **inside the staged release directory**. CI compares hashes of all signed `src`, `web`, `package.json` and `package-lock.json` files before and after dependency installation.
3. The script creates a **transient, run-specific** systemd unit that starts the staged signed source, not the checkout. The unit uses the unprivileged `runner` account, binds exclusively to `127.0.0.1`, and enables `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp` and a restrictive umask.
4. The test checks live HTTP status, intentionally unavailable production readiness (HTTP **503**), the explicit `productionReady:false` status and the login asset. It performs a real `systemctl restart`, verifies a different PID and repeats HTTP checks.
5. The test intentionally kills **only the ephemeral CI unit main process** and confirms that systemd automatically recovers it with another PID and healthy development-only HTTP endpoints.
6. The script stops the transient unit and removes the disposable signed source directory. The hosted VM is discarded at job completion.

## What is not proven

The temporary service runs under the GitHub `runner` user, not the final restricted `domyro` service account. The test does **not** install a permanent unit, configure `/opt/domyro`, `/etc/domyro`, `/var/lib/domyro`, create TLS certificates, provision PostgreSQL/MQTT/Zigbee2MQTT/Matter, perform migrations or restore user secrets. It does not use a pinned official production signing key, reproduce a complete .deb installer, survive an actual VM reboot or demonstrate complete multi-service rollback. It does not connect to or modify any of the owner's servers or devices.

A process returning HTTP 200 on a live endpoint is **not** evidence of production readiness. D-53 stays closed until the complete one-line installer, manual updater and verified full recovery have passed independent tests and @TheRoyalCaptain separately approves deployment.

See [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [NATIVE-DEPENDENCIES-AND-UPDATE-REHEARSAL.md](NATIVE-DEPENDENCIES-AND-UPDATE-REHEARSAL.md) and [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
