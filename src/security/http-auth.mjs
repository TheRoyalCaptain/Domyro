// SPDX-License-Identifier: AGPL-3.0-only
// LOCAL DEVELOPMENT ONLY: no WAN, reverse proxy, PWA onboarding or production
// authentication promise. HTTPS, MFA, recovery and shared rate limiting remain
// official-installation requirements.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createDbSession, resolveDbSession, revokeDbSession, hashPassword, verifyPassword, hashSessionToken } from './credentials.mjs';
import { listSitesForUser, listAreasForUser, createAreaForUser } from '../persistence/site-repository.mjs';
import { getDevelopmentUpdateStatus } from '../lifecycle/update-center.mjs';

const LOGIN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/;
const SESSION_NAME = 'domyro_session';
const MAX_JSON = 4096;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localRequest(req) {
  const remote = req.socket.remoteAddress ?? '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) &&
    typeof req.headers.host === 'string' && LOCAL_HOST.test(req.headers.host);
}

function correctOrigin(req) {
  const expected = 'http://' + req.headers.host;
  return req.headers.origin === expected && ['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site']);
}

function validJsonContentType(req) {
  return /^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '');
}

async function jsonBody(req) {
  if (!validJsonContentType(req)) throw new Error('unsupported_media_type');
  const chunks = [];
  let size = 0;
  for await (const piece of req) {
    size += piece.length;
    if (size > MAX_JSON) throw new Error('body_too_large');
    chunks.push(piece);
  }
  try {
    const obj = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error();
    return obj;
  } catch { throw new Error('invalid_json'); }
}

function sessionCookie(req) {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  const matches = raw.split(';').map(x => x.trim()).filter(x => x.startsWith(SESSION_NAME + '='));
  if (matches.length !== 1) return null;
  return matches[0].slice(SESSION_NAME.length + 1);
}

function csrfForToken(token) {
  return createHmac('sha256', hashSessionToken(token)).update('domyro:csrf:v1').digest('base64url');
}

function equalCsrf(received, expected) {
  if (typeof received !== 'string' || received.length !== expected.length || !/^[A-Za-z0-9_-]+$/.test(received)) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function clearCookie(response) {
  response.setHeader('set-cookie', SESSION_NAME + '=; HttpOnly; Path=/api/v1; SameSite=Strict; Max-Age=0');
}
function setCookie(response, token) {
  // HTTP-only cookie is intentionally restricted to the local loopback preview.
  // Future HTTPS/reverse-proxy deployment MUST use a Secure __Host- cookie.
  response.setHeader('set-cookie', SESSION_NAME + '=' + token + '; HttpOnly; Path=/api/v1; SameSite=Strict; Max-Age=3600');
}

export async function createLocalAuthService(db, sendJson) {
  if (!db || typeof db.query !== 'function' || typeof sendJson !== 'function') throw new TypeError('auth_dependencies_invalid');
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const failures = new Map();

  function limited(key) {
    const now = Date.now();
    if (failures.size > 2000) {
      for (const [item, entry] of failures) if (entry.until < now) failures.delete(item);
      if (failures.size > 2000) failures.clear();
    }
    const record = failures.get(key);
    if (!record || record.until <= now) return false;
    return record.count >= MAX_FAILURES;
  }
  function recordFailure(key) {
    const now = Date.now();
    const record = failures.get(key);
    failures.set(key, !record || record.until < now ? { count: 1, until: now + RATE_WINDOW_MS } : { ...record, count: record.count + 1 });
  }

  async function authenticated(req, res, { checkCsrf = false } = {}) {
    const token = sessionCookie(req);
    const actor = token ? await resolveDbSession(db, token) : null;
    if (!actor) { sendJson(res, 401, { error: 'authentication_required' }); return null; }
    if (checkCsrf && !equalCsrf(req.headers['x-domyro-csrf'], csrfForToken(token))) {
      sendJson(res, 403, { error: 'csrf_required' }); return null;
    }
    return { ...actor, token };
  }

  return Object.freeze({
    /**
     * @returns {Promise<boolean>} whether this route has been handled
     */
    async route(req, res, pathname) {
      const known = pathname === '/api/v1/system/updates' || pathname === '/api/v1/system/updates/install' ||
        pathname === '/api/v1/auth/login' || pathname === '/api/v1/auth/logout' ||
        pathname === '/api/v1/auth/me' || pathname === '/api/v1/sites' ||
        /^\/api\/v1\/sites\/[^/]+\/areas$/.test(pathname);
      if (!known) return false;

      if (!localRequest(req)) { sendJson(res, 403, { error: 'loopback_required' }); return true; }
      const isWrite = req.method === 'POST';
      if (isWrite && !correctOrigin(req)) { sendJson(res, 403, { error: 'same_origin_required' }); return true; }
      if (!['GET', 'POST'].includes(req.method ?? '')) {
        sendJson(res, 405, { error: 'method_not_allowed' }); return true;
      }

      if (pathname === '/api/v1/auth/login') {
        if (!isWrite) { sendJson(res, 405, { error: 'method_not_allowed' }); return true; }
        let body;
        try { body = await jsonBody(req); }
        catch (e) { sendJson(res, e.message === 'body_too_large' ? 413 : e.message === 'unsupported_media_type' ? 415 : 400, { error: 'invalid_request' }); return true; }
        const login = body.login, password = body.password;
        if (typeof login !== 'string' || !LOGIN.test(login) || typeof password !== 'string' || password.length > 512) {
          sendJson(res, 400, { error: 'invalid_credentials' }); return true;
        }
        const key = req.socket.remoteAddress + ':' + login;
        if (limited(key)) { sendJson(res, 429, { error: 'too_many_attempts' }); return true; }
        let user;
        try {
          const result = await db.query('SELECT id, login, password_hash FROM domyro_users WHERE login=$1 AND disabled_at IS NULL', [login]);
          user = result.rows[0] ?? null;
        } catch { sendJson(res, 503, { error: 'authentication_unavailable' }); return true; }
        const ok = await verifyPassword(user?.password_hash ?? dummyHash, password);
        if (!user || !ok) {
          recordFailure(key);
          sendJson(res, 401, { error: 'invalid_credentials' });
          return true;
        }
        failures.delete(key);
        const session = await createDbSession(db, user.id);
        setCookie(res, session.token);
        sendJson(res, 200, { user: { id: user.id, login: user.login }, csrfToken: csrfForToken(session.token), expiresAt: session.expiresAt });
        return true;
      }

      const actor = await authenticated(req, res, { checkCsrf: isWrite });
      if (!actor) return true;

      if (pathname === '/api/v1/system/updates' || pathname === '/api/v1/system/updates/install') {
        // System-wide information requires an enabled account with owner/admin
        // membership. Mere login, resident and guest roles are insufficient.
        const authorization = await db.query(`
          SELECT 1 FROM domyro_site_memberships m
          JOIN domyro_users u ON u.id = m.user_id
          WHERE m.user_id=$1 AND u.disabled_at IS NULL
            AND m.role IN ('owner','admin') LIMIT 1
        `, [actor.user_id]);
        if (authorization.rowCount !== 1) {
          sendJson(res, 403, { error: 'system_administrator_required' });
          return true;
        }
        if (pathname.endsWith('/install')) {
          // Neither authenticated session nor CSRF token bypasses D-53.
          // Explicitly blocked: NO file I/O, package installs or restarts.
          sendJson(res, 423, { error: 'installation_gate_closed', decision: 'D-53' });
          return true;
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method_not_allowed' });
          return true;
        }
        sendJson(res, 200, getDevelopmentUpdateStatus());
        return true;
      }

      if (pathname === '/api/v1/auth/logout') {
        if (!isWrite) { sendJson(res, 405, { error: 'method_not_allowed' }); return true; }
        await revokeDbSession(db, actor.session_id, actor.user_id);
        clearCookie(res);
        sendJson(res, 200, { loggedOut: true }); return true;
      }
      if (pathname === '/api/v1/auth/me') {
        if (req.method !== 'GET') { sendJson(res, 405, { error: 'method_not_allowed' }); return true; }
        const user = await db.query('SELECT login FROM domyro_users WHERE id=$1 AND disabled_at IS NULL', [actor.user_id]);
        if (user.rowCount !== 1) { sendJson(res, 401, { error: 'authentication_required' }); return true; }
        sendJson(res, 200, { id: actor.user_id, login: user.rows[0].login, csrfToken: csrfForToken(actor.token) });
        return true;
      }
      if (pathname === '/api/v1/sites') {
        if (req.method !== 'GET') { sendJson(res, 405, { error: 'method_not_allowed' }); return true; }
        sendJson(res, 200, { sites: await listSitesForUser(db, actor.user_id) }); return true;
      }

      const match = /^\/api\/v1\/sites\/([^/]+)\/areas$/.exec(pathname);
      if (!match || !UUID.test(match[1])) { sendJson(res, 404, { error: 'not_found' }); return true; }
      if (req.method === 'GET') {
        sendJson(res, 200, { areas: await listAreasForUser(db, actor.user_id, match[1]) });
        return true;
      }
      let input;
      try { input = await jsonBody(req); }
      catch (e) { sendJson(res, e.message === 'body_too_large' ? 413 : 400, { error: 'invalid_request' }); return true; }
      try {
        const created = await createAreaForUser(db, actor.user_id, match[1], input.displayName);
        sendJson(res, 201, { area: created });
      } catch (e) {
        sendJson(res, e.message === 'site_permission_denied' ? 403 : e instanceof TypeError ? 400 : 503,
          { error: e.message === 'site_permission_denied' ? 'forbidden' : e instanceof TypeError ? 'invalid_request' : 'database_unavailable' });
      }
      return true;
    },
  });
}
