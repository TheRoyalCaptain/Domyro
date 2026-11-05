# Installation and built-in updates: release handoff

Target: Ubuntu 24.04 AMD64 or ARM64, native systemd services, no Docker.
The standalone installer provisions pinned Node, native PostgreSQL when absent,
Domyro, the owner account, and an independent privileged update service.
Updates are requested through the authenticated portal and verified against the
same publisher key. Failed same-schema updates restore code, configuration and
the database. Existing installations and interrupted first installs are never
silently overwritten.

## What is not yet a public release

The code is on PR #4, not main. `release-publisher.json` is unconfigured and the
production readiness record is closed. No install URL or release can currently
be promised to an owner. Tests use ephemeral keys and cannot become production
signing authority. The current release gate also covers MQTT/Matter functionality,
full encrypted backups, secure onboarding, and VM/bare-metal recovery evidence;
passing the core installer tests does not assert those features are finished.

## Publisher preparation (repository owner workstation)

Use a trusted checkout and Node on the workstation. Choose a new private folder
outside every Git repository. The parent must belong to you and not be writable
by other users. For example, if `/home/kevin` is your actual private home:

```sh
node tools/setup-release-publisher.mjs /home/kevin/domyro-signing
```

This creates a new Ed25519 key with mode 0600, a public policy, and the public
fingerprint. It refuses existing directories and never uploads or prints the
private key. Back up that private folder securely: changing the key without a
planned rotation would prevent existing installations from trusting updates.

With GitHub CLI authenticated as the repository owner, configure the
`production-release` environment and its review protections in GitHub Settings.
Then upload the secret directly from the private file:

```sh
gh secret set DOMYRO_RELEASE_ED25519_PRIVATE_KEY_PEM --repo TheRoyalCaptain/Domyro --env production-release < /home/kevin/domyro-signing/release-private.pem
```

Copy **only** `release-publisher.json` to `config/release-publisher.json`, review
the fingerprint, and commit the public policy. Never commit the PEM private key.
This ChatGPT GitHub connection does not expose secret-setting or environment
administration; preparing the tool does not mean the secret has been configured.

## Publication checks

1. Complete and review the actual readiness evidence. Do not change false
   checks to true merely to get past the release gate. Decide the intended
   product scope explicitly if a limited core preview is wanted.
2. Review and merge PR #4, commit the public publisher policy, and set consistent
   release versions in package.json and package-lock.json.
3. Run the official signed-source workflow on main with the matching stable
   version. It verifies the signer, builds and signs both source packages plus
   the standalone installer, and creates a draft release.
4. Review the generated INSTALL.txt, installer checksum/signature, source
   artifacts and native CI evidence before publishing that draft.
5. Distribute the pinned installation command through a trusted channel. It
   downloads a fixed version, checks SHA-256 before sudo/Python execution, then
   performs the native install. Python 3.12, CA certificates, curl and sudo must
   already be available on the target.

## First access and updates

The current server binds to loopback port 8844. From a workstation with SSH
access, forward the port using `ssh -L 8844:127.0.0.1:8844 user@server`, then open
http://127.0.0.1:8844. Use account `owner`; read the initial password privately
with `sudo cat /etc/domyro/owner-password.txt` on the server. This is the tested
access path. LAN HTTPS onboarding is still outstanding; do not expose the
loopback HTTP service publicly as a shortcut.

Publish subsequent signed releases with the same publisher key. The portal
checks for compatible versions and submits authenticated installation requests
to the independent worker. Current updates support the same database schema;
unsupported schema changes are rejected rather than attempted without recovery
support. Runtime/supervisor upgrades and signing-key rotation need their own
reviewed lifecycle before they can be advertised as supported.
