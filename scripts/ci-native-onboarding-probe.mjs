// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI-ONLY: exercise actual database-backed native systemd deployment on a
 * disposable GitHub Ubuntu runner. Refuses arbitrary endpoints and hosts.
 * No production release or owner-host installation.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

async function main() {
  const [base, passwordPath, stage] = process.argv.slice(2);
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      process.env.DOMYRO_CI_SYSTEMD_ALLOWED !== '1' ||
      process.env.DOMYRO_CI_PG_ONBOARDING !== '1' ||
      process.env.USER !== 'runner' ||
      !['initial', 'after-restart', 'after-crash'].includes(stage) ||
      !/^http:\/\/127\.0\.0\.1:[0-9]{2,5}$/.test(base) ||
      !Number.isSafeInteger(Number(new URL(base).port)) ||
      !passwordPath?.startsWith(resolve(process.env.GITHUB_WORKSPACE) + '/.domyro-ci-signed-')) {
    throw new Error('ci_native_onboarding_scope_invalid');
  }
  const password = (await readFile(passwordPath, 'utf8')).trim();
  if (password.length < 16) throw new Error('ci_test_password_invalid');
  const post = async (path, body, csrf, cookie) => fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': base,
      'Sec-Fetch-Site': 'same-origin',
      ...(csrf ? { 'X-Domyro-Csrf': csrf } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000),
  });
  const untrusted = await fetch(base + '/api/v1/system/updates');
  if (untrusted.status !== 401) throw new Error('ci_updates_not_protected');
  const login = await post('/api/v1/auth/login', {
    login: 'native-test-owner', password,
  });
  if (login.status !== 200) throw new Error('ci_owner_login_failed_' + login.status);
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  if (!session.startsWith('domyro_session=')) throw new Error('ci_session_cookie_missing');
  const body = await login.json();
  if (!body.csrfToken || body.user.login !== 'native-test-owner') {
    throw new Error('ci_owner_login_invalid');
  }
  const authorized = await fetch(base + '/api/v1/system/updates', {
    headers: { Cookie: session },
    signal: AbortSignal.timeout(7000),
  });
  if (authorized.status !== 200 || (await authorized.json()).installAllowed !== false) {
    throw new Error('ci_update_install_gate_not_closed');
  }
  const install = await post('/api/v1/system/updates/install',
    { confirmedVersion: '999.0.0' }, body.csrfToken, session);
  if (install.status !== 423 || (await install.json()).decision !== 'D-53') {
    throw new Error('ci_update_install_d53_bypassed');
  }
  const sites = await fetch(base + '/api/v1/sites', {
    headers: { Cookie: session },
    signal: AbortSignal.timeout(7000),
  });
  if (sites.status !== 200) throw new Error('ci_site_listing_failed');
  const listed = (await sites.json()).sites;
  if (listed.length !== 1 || listed[0].display_name !== 'CI Home') {
    throw new Error('ci_onboarded_site_missing');
  }
  const siteId = listed[0].id;
  const areasPath = '/api/v1/sites/' + siteId + '/areas';
  const first = await fetch(base + areasPath, {
    headers: { Cookie: session }, signal: AbortSignal.timeout(7000),
  });
  if (first.status !== 200) throw new Error('ci_area_listing_failed');
  const areas = (await first.json()).areas;
  if (stage === 'initial') {
    if (areas.length !== 0) throw new Error('ci_fresh_install_not_empty');
    const created = await post(areasPath, { displayName: 'CI Living Room' },
      body.csrfToken, session);
    if (created.status !== 201) throw new Error('ci_area_creation_failed');
  } else if (areas.length !== 1 || areas[0].display_name !== 'CI Living Room') {
    throw new Error('ci_area_not_durable_across_service_restart');
  }
  const status = await fetch(base + '/api/v1/health/ready', {
    signal: AbortSignal.timeout(7000),
  });
  if (status.status !== 503 || (await status.json()).reason !== 'production_features_incomplete') {
    throw new Error('ci_production_readiness_falsely_green');
  }
  process.stdout.write('CI disposable native PostgreSQL owner/login/areas persisted: ' + stage + '; D-53 CLOSED\n');
}
if (process.argv[1] && import.meta.url === new URL('file://' + resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message.startsWith('ci_') ? error.message : 'ci_onboarding_probe_failed');
    process.exitCode = 1;
  });
}
