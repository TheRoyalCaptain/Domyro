# Domyro — Official repository authority and GitHub security

**Version 1.0 · 2026-10-30 · Owner policy fixed**  
**Official owner / sole final approver: @TheRoyalCaptain**  
**Source license: GNU Affero General Public License version 3 only (SPDX AGPL-3.0-only)**

## 1. What this means

This is real free and open-source software. Anyone may fork, change, use, share and redistribute code under the AGPLv3 terms, and modified network-served versions have the applicable source offer obligations. The project owner **cannot prohibit lawful AGPL forks or edits in their repositories**.

Official upstream authority is separate. Only **@TheRoyalCaptain** can approve a change into `TheRoyalCaptain/Domyro` or declare an official release. A pull request is a proposal; it is not accepted automatically. Anyone else's fork is independent and must not claim to be endorsed by the official Domyro project. Copyright license rights are separate from trademark rights; trademark registration is not yet verified.

The project's currently documented license is **AGPL-3.0-only**, not the optional “or later” clause. The unmodified license text is in root `LICENSE`.

## 2. Versioned controls already committed

- `.github/CODEOWNERS`: `* @TheRoyalCaptain` covers all files; explicitly protects `/.github/` and the CODEOWNERS file.
- `CONTRIBUTING.md`: accepts external proposals but grants sole official merge/release authority to owner.
- `.github/PULL_REQUEST_TEMPLATE.md`: owner approval, test, license and planning requirements.
- `SECURITY.md`: coordinated private disclosure and baseline operations.
- `README.md`, `docs/MASTERPLAN.md` and `docs/DECISIONS.md`: policy and status of planning sign-off.

**CODEOWNERS alone is not a barrier against unwanted merges**. Settings must also be enabled through the GitHub website, and other admins or privileged apps can weaken rules. No direct admin mutation is available to this GitHub connector.

## 3. Required owner settings (perform manually in GitHub)

### A. Create an active branch ruleset for main

Go to **Repository > Settings > Rules > Rulesets > New ruleset > New branch ruleset**.

- Name: `Domyro Official Main Protection`.
- Enforcement: **Active** (not Evaluate or Disabled).
- Target: default branch / `main`.
- **Require a pull request before merging**: enabled.
- **Required approvals**: at least 1.
- **Require review from Code Owners**: enabled.
- **Dismiss stale pull request approvals when new commits are pushed**: enabled, if available.
- **Require conversation resolution before merging**: enabled.
- **Block force pushes**: enabled.
- **Restrict deletions**: enabled/keep default blocking.
- **Bypass**: only the repository admin/owner role if needed for the owner's own solo-authored changes. Do not grant contributor, bot or app bypass. Test actual bypass behavior; on a personal repo a role-based admin bypass may extend to any future admin, so never grant another admin. Avoid an unconditional bypass granted to all writers.
- **Require status checks** only after named CI checks actually exist, otherwise merges can be blocked permanently.
- For official release branches/tags create additional target rules if relevant once release management begins.

Why bypass? GitHub does not allow a PR author to approve their own changes. With sole code owner review and zero other authorized reviewers, the owner needs an explicit owner-only administrative route for self-authored changes; otherwise all owner PRs may become unmergeable. Bypass is an *exception*, not proof of review. Record self-approved commits as maintainer decisions.

If ruleset options differ in the available GitHub plan/interface, use **Settings > Branches > Add branch protection rule** and apply the same core constraints: at least one PR approval + CODEOWNER approval + stale-review dismissal + no force-push/deletion. On personal-account repositories, **Restrict who can push to matching branches** is not generally available like organization repo push restrictions; do not assume that checkbox exists.

### B. Protect permissions

Go to **Settings > Collaborators** (or **Collaborators and teams** as visible) and keep **Admin solely @TheRoyalCaptain**. Prefer external contributions by fork + PR, no other direct Write/Maintain/Admin grants. Audit installed GitHub Apps and automation deploy keys. Revoke unnecessary tokens, configure fine-grained scopes and keep GitHub Actions `GITHUB_TOKEN` read-only by default when CI is added.

Use 2FA or passkeys on the account and review active sessions/security alerts. An account takeover of @TheRoyalCaptain defeats sole-owner control.

### C. Repository security features

Go to **Settings > Security & analysis / Code security and analysis** (labels vary by plan and UI). Enable:
- secret scanning and push protection if available;
- dependency graph and Dependabot alerts;
- automatic security updates if compatible with review-and-release controls (Dependabot PRs are proposals, not automatic official merges);
- private vulnerability reporting if available;
- CodeQL/code scanning once application code exists.

Set pull-request policies to disallow auto-merge unless it cannot bypass code-owner review, and require owner-initiated official release publishing. Apply release tag protection and require verified/signed artifacts before public production releases.

### D. Repository defaults

Keep default branch `main`; keep repo public and forks permitted. Enable Discussions/Issues only if maintainable. Require PR description using template. Never configure a third-party auto-merge bot as bypass actor.

## 4. Validation tests after UI setup

1. Confirm CODEOWNERS shown on a random file, on README and on `.github/CODEOWNERS`.
2. Open test PR from a second account (no write access) and verify it cannot merge and requests review from @TheRoyalCaptain.
3. Verify an unrelated reviewer cannot satisfy owner review condition.
4. Verify new commits after approval invalidate stale approval.
5. Confirm a non-owner cannot force push/delete `main` or approve their own merge.
6. Verify owner can safely merge an accepted external PR and handle self-authored changes using the expected admin route.
7. Confirm `main` and any release tags can't be updated by unexpected CI/bot tokens.
8. Review audit/settings periodically and after inviting a collaborator or installing an app.

**Pass criteria:** external PRs cannot enter official main without owner approval, except actions from an account/app with bypass permissions; all such bypass grants must be owner-controlled, explicitly documented and minimized.

## 5. Scope limits and risks

- The GitHub connector can commit documentation/CODEOWNERS but does not expose branch-ruleset editing; the owner must enable protections in Settings.
- Access to the classic branch protection API was denied to this connection, so classic protection **cannot be confirmed as absent**. The visible ruleset listing was empty at time of writing; recheck in GitHub UI after setup.
- Usernames/passwords and third-party app token compromise can defeat procedural governance.
- Anyone is legally free to fork and redistribute Domyro under AGPLv3. Forks cannot be restricted using the upstream branch rules.
- An individual author's GitHub review cannot be counted for their own PR. A single-owner project cannot combine enforced no-bypass, no other approver and unrestricted self-authored merges.
- Contributors own their contributions unless otherwise arranged; AGPL-compliant contributions may not be relicensed unilaterally to proprietary terms by upstream.

## 6. References

- Official GitHub protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Official GitHub CODEOWNERS: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- Official GitHub rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- GNU AGPL: https://www.gnu.org/licenses/agpl-3.0.html
