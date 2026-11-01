# Signed download-only staging rehearsal (development only)

**Milestone:** 2 November 2026  
**Governance:** This is an AI-built project developed in cooperation with and under the supervision of [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).  
**Deployment gate D-53: CLOSED.** This milestone is not a production updater or an installer.

## What this adds

The new `src/lifecycle/download-only-rehearsal.mjs` exercises a real HTTP transfer of a signed development release bundle. It enforces the existing signed-release update policy before any request:

- A pinned Ed25519 trust root, verified manifest and newer compatible version are mandatory.
- Architecture and PostgreSQL schema compatibility are checked.
- Automatic checking and **automatic download** must both be explicitly enabled.
- The configured download delay must have elapsed.
- The download URL must be an exact signed artifact filename at **127.0.0.1** over HTTP. Remote URLs, DNS names, credentials, query strings, redirects and arbitrary paths are refused. This restriction intentionally makes it a local integration-test component, not a production download client.
- The transfer is streamed in bounded chunks with a 64 MiB hard ceiling and an exact signed byte count. A SHA-256 mismatch or malformed HTTP response is rejected.
- Only after verification is the source bundle extracted to an OS-created temporary private directory, and the staged files are verified again. The release pointer stays inactive and the entire scratch directory is removed, including after failures.

The tests in `tests/download-only-rehearsal.test.mjs` cover real loopback HTTP, signing and delay policy, wrong architecture/schema, tampering, unexpected bytes, HTTP failures, redirects, malicious URLs and interrupted staging. The tests run under the standard Ubuntu AMD64/ARM64 Node 22/24 GitHub CI matrix.

The separate `scripts/ci-real-systemd-test.sh` now also exercises **automatic systemd crash recovery** on disposable GitHub-hosted Ubuntu 24.04 runners: it kills only its uniquely named transient CI service process, waits for systemd to restart it with a different PID, checks the service's restart counter, and rechecks HTTP liveness and the intentionally unavailable production readiness endpoint. This is separate from the manual restart test.

## Still missing before owner deployment

No official public HTTPS release feed, signing-key lifecycle, production artifact downloader, persistent staging worker, native restricted service account, real service deployment, owner-authorized installation or verified full-system rollback exists yet. A successful development download **never** installs, restarts or migrates anything. PostgreSQL/configuration/Matter recovery remains incomplete.

Do not run these development components on the owner's servers or expose the local test downloader as a remote service. The project must remain marked **not production ready** and D-53 must remain **closed** until independently validated technical readiness and separate explicit owner approval.
