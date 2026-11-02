# Native Ubuntu installer: evidence-backed preflight (development)

**Status: read-only diagnostic and pure validation. D-53 remains closed.**

This is one component of Domyro's future native one-line installer. It does **not** install Node, PostgreSQL, Mosquitto, Zigbee2MQTT or Matter, create accounts, fetch release artifacts, start systemd or configure a server.

## Developer usage

From an existing checkout that already has a working Node.js runtime:

```bash
npm run preflight:install:read-only
node scripts/inspect-native-install.mjs --json --port=8844
```

This command inspects the **machine on which the command is invoked**. It does not check someone else's computer or any connected smart-home devices. It does not need root.

The diagnostic checks:
- Ubuntu LTS host resource requirements and current supported installation matrix (Ubuntu 24.04, x86-64 or ARM64).
- Whether systemd is running as PID 1 and whether `/usr/bin/systemctl` and `/usr/bin/apt-get` are executable.
- Whether pre-existing Domyro config, data, release or systemd-unit paths might be overwritten. Symlinks are counted as existing paths, not followed.
- Whether the selected web port appears in Linux's IPv4 and IPv6 `/proc/net/tcp*` listening-socket snapshots. Missing/unparseable snapshots are **unknown**, never considered available. Reserved system/service ports are refused.
- Whether the current Node runtime is at least 22.12.0. If it is older, provisioning a supported runtime is identified as an outstanding task, rather than assuming Ubuntu's default Node is sufficient.

The snapshot never opens a socket, reserves a port, connects to MQTT/PostgreSQL, reads secrets, runs `apt`, writes to disk or restarts a process. **Not observing a listening port does not prove that the port will still be free during installation**, because another process may bind it afterward. The future installer must recheck this when actually starting a service.

An installed/active PostgreSQL or Mosquitto service, even with an open TCP port, is **not** equivalent to a verified, authenticated existing service. Existing service credentials and ownership must be validated separately and may not be assumed from the diagnostic.

## Tests

`tests/native-install-evidence.test.mjs` verifies IPv4/IPv6 parser behavior, occupied ports, uninspectable resources, unsafe paths, unsupported systemd/Ubuntu conditions, minimum system resources and the never-install invariant. `npm run check` runs the new tests within the existing GitHub Actions platform matrix.

## Next steps before release

1. Authenticated and permission-safe connection validation for any explicitly chosen external service, without disclosing credentials.
2. A real, signed and pinned native package/bootstrap chain and repeatable service provisioning for Ubuntu 24.04 on both architectures.
3. Non-destructive installation with an independently validated backup and recovery path for PostgreSQL, Domyro config and Matter fabrics.
4. First-run browser onboarding, explicitly approved core updates and independently tested rollback on actual VM and hardware.
5. Explicit human review and a separate deployment decision; all D-53 checks remain false until independently satisfied.

This diagnostic does not change `config/installation-readiness.json`, release eligibility or the disabled installation endpoint.
