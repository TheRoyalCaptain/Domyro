# Security Policy

## Current status

Domyro is in documentation-only planning. No built software, deployed service or official runnable release exists yet. Security fixes and security features will be implemented after the owner formally approves the architecture (G0).

## Vulnerability reporting

If you identify a vulnerability in the official repository documentation, tooling, dependencies (when added), or later a release, use GitHub's **Report a vulnerability** / private security advisory feature **if it is enabled** for this repository. Do not publish exploit details or real credentials in a public issue.

If private vulnerability reporting is not yet enabled, contact the repository owner via GitHub without exposing exploit details, and ask for a private disclosure channel. No particular response deadline is guaranteed while the project is maintained by an individual.

## Official update authority

Only **@TheRoyalCaptain** can accept and publish official Domyro changes and releases. `.github/CODEOWNERS` expresses this policy; GitHub branch protection/ruleset and collaborator permissions must separately enforce it. Keep admin permissions with the owner only.

## Planned protective controls

- GitHub branch rules: owner code review on PRs, ban force push and branch deletion, block bypass from other accounts/apps, approval expiry after new commits.
- Minimal write permissions for humans and apps, 2FA/passkey on maintainers, audited connected apps and fine-grained access tokens.
- OIDC publishing and artifact signatures for releases, SBOM, dependabot and scanning after implementation.
- Private secret handling, credential scanning, verified releases and documented remediation process before beta.
- No executable code contributions until G0 sign-off.

The current configuration of GitHub branch protections cannot be verified via this connector. See [docs/GITHUB-GOVERNANCE.md](docs/GITHUB-GOVERNANCE.md) for the owner's settings checklist.
