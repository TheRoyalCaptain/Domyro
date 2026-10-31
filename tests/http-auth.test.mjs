// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDomyroServer } from '../src/server.mjs';
import { bootstrapOwner } from '../src/security/bootstrap.mjs';
import { createLocalAuthService } from '../src/security/http-auth.mjs';
import { sendJson } from '../src/lib/http.mjs';
import { hashPassword, createDbSession } from '../src/security/credentials.mjs';
import { applyMigrations, loadMigrations } from '../src/persistence/migrator.mjs';

test('console-only owner setup + full local cookie login, CSRF, site authorization and logout', {
  skip: !process.env.DOMYRO_TEST_DATABASE_URL,
}, async t => {
  const { Pool } = await import('pg');
  const dbName = 'domyro_auth_' + randomBytes(8).toString('hex');
  const original = new URL(process.env.DOMYRO_TEST_DATABASE_URL);
  const admin = new Pool({ connectionString: original.href, max: 2 });
  const isolated = new URL(original.href);
  isolated.pathname = '/' + dbName;
  await admin.query('CREATE DATABASE "' + dbName + '"');
  const db = new Pool({ connectionString: isolated.href, max: 4 });
  t.after(async () => {
    await db.end();
    await admin.query('DROP DATABASE IF EXISTS "' + dbName + '"');
    await admin.end();
  });
  const client = await db.connect();
  try { await applyMigrations(client, await loadMigrations()); }
  finally { client.release(); }

  const owner = await bootstrapOwner(db, {
    login: 'home-owner', password: 'an-isolated-test-password-only-123',
    site: { displayName: 'Thuis', timeZone: 'Europe/Amsterdam', locale: 'nl' },
  });
  assert.ok(owner.userId && owner.siteId);
  await assert.rejects(() => bootstrapOwner(db, {
    login: 'second-owner', password: 'also-strong-but-not-allowed',
    site: { displayName: 'Second' },
  }), /owner_already_initialized/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM domyro_users')).rows[0].n, 1);

  const auth = await createLocalAuthService(db, sendJson);
  const server = createDomyroServer({
    persistence: { inspect: async () => ({ ready: true, schemaVersion: 2 }) }, auth,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const jsonHeaders = { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' };
  const post = (path, body, headers = {}, cookie) => fetch(base + path, {
    method: 'POST', headers: { ...jsonHeaders, ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  assert.equal((await fetch(base + '/api/v1/auth/me')).status, 401);
  assert.equal((await fetch(base + '/api/v1/sites')).status, 401);
  assert.equal((await post('/api/v1/auth/login', { login: 'home-owner', password: 'an-isolated-test-password-only-123' }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await post('/api/v1/auth/login', { login: 'home-owner', password: 'wrong-password-1234' })).status, 401);
  const login = await post('/api/v1/auth/login', { login: 'home-owner', password: 'an-isolated-test-password-only-123' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const sessionCookie = cookie.split(';')[0];
  const token = await login.json();
  assert.equal(token.user.login, 'home-owner');
  assert.equal(token.csrfToken.length, 43);
  const me = await fetch(base + '/api/v1/auth/me', { headers: { cookie: sessionCookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).csrfToken, token.csrfToken);

  const sites = await fetch(base + '/api/v1/sites', { headers: { cookie: sessionCookie } });
  assert.equal(sites.status, 200);
  assert.equal((await sites.json()).sites[0].id, owner.siteId);

  const areasPath = '/api/v1/sites/' + owner.siteId + '/areas';
  assert.equal((await post(areasPath, { displayName: 'Woonkamer' }, {}, sessionCookie)).status, 403);
  assert.equal((await post(areasPath, { displayName: 'Woonkamer' }, { 'x-domyro-csrf': 'wrong' }, sessionCookie)).status, 403);
  assert.equal((await post(areasPath, { displayName: 'Woonkamer' }, { origin: 'http://evil.example', 'x-domyro-csrf': token.csrfToken }, sessionCookie)).status, 403);
  const created = await post(areasPath, { displayName: 'Woonkamer' }, { 'x-domyro-csrf': token.csrfToken }, sessionCookie);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).area.display_name, 'Woonkamer');
  const ownAreas = await fetch(base + areasPath, { headers: { cookie: sessionCookie } });
  assert.equal((await ownAreas.json()).areas.length, 1);
  const otherSite = '/api/v1/sites/' + randomUUID() + '/areas';
  assert.equal((await fetch(base + otherSite, { headers: { cookie: sessionCookie } })).status, 200);
  assert.equal((await (await fetch(base + otherSite, { headers: { cookie: sessionCookie } })).json()).areas.length, 0);

  // A guest can view the assigned site's areas but cannot create them.
  const guestId = randomUUID();
  await db.query('INSERT INTO domyro_users(id,login,password_hash) VALUES($1,$2,$3)',
    [guestId, 'home-guest', await hashPassword('a-secure-guest-test-password')]);
  await db.query("INSERT INTO domyro_site_memberships(site_id,user_id,role) VALUES($1,$2,'guest')",
    [owner.siteId, guestId]);
  const guestSession = await createDbSession(db, guestId);
  const guestCookie = 'domyro_session=' + guestSession.token;
  const guestMe = await fetch(base + '/api/v1/auth/me', { headers: { cookie: guestCookie } });
  assert.equal(guestMe.status, 200);
  const guestCsrf = (await guestMe.json()).csrfToken;
  const denied = await post(areasPath, { displayName: 'Not allowed' }, { 'x-domyro-csrf': guestCsrf }, guestCookie);
  assert.equal(denied.status, 403);
  assert.equal((await (await fetch(base + areasPath, { headers: { cookie: guestCookie } })).json()).areas.length, 1);

  const logout = await post('/api/v1/auth/logout', {}, { 'x-domyro-csrf': token.csrfToken }, sessionCookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(base + '/api/v1/auth/me', { headers: { cookie: sessionCookie } })).status, 401);
  assert.equal((await fetch(base + '/api/v1/auth/me', { headers: { cookie: 'domyro_session=malformed' } })).status, 401);
  // Undici fetch may normalize Host, so use a genuine raw HTTP request to
  // prove DNS-rebinding-style host spoofing is rejected.
  const { request: rawHttpRequest } = await import('node:http');
  const forgedHostCode = await new Promise((resolve, reject) => {
    const req = rawHttpRequest(base + '/api/v1/sites', {
      headers: { Host: 'malicious.example', Cookie: guestCookie },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(forgedHostCode, 403);
  assert.equal((await fetch(base + '/api/v1/health/ready')).status, 503);
});

test('unknown user login is rate-limited, without account enumeration', {
  skip: !process.env.DOMYRO_TEST_DATABASE_URL,
}, async t => {
  const { Pool } = await import('pg');
  const db = new Pool({ connectionString: process.env.DOMYRO_TEST_DATABASE_URL, max: 2 });
  t.after(() => db.end());
  const client = await db.connect();
  try { await applyMigrations(client, await loadMigrations()); }
  finally { client.release(); }
  const auth = await createLocalAuthService(db, sendJson);
  const server = createDomyroServer({ auth });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (let i = 0; i < 6; i++) {
    const result = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'no-such-user', password: 'a-test-password-123456' }),
    });
    assert.equal(result.status, i < 5 ? 401 : 429);
  }
});
