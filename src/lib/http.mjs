// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', { filename: '../../web/index.html', mime: 'text/html; charset=utf-8' }],
  ['/index.html', { filename: '../../web/index.html', mime: 'text/html; charset=utf-8' }],
  ['/assets/styles.css', { filename: '../../web/assets/styles.css', mime: 'text/css; charset=utf-8' }],
  ['/assets/app.js', { filename: '../../web/assets/app.js', mime: 'text/javascript; charset=utf-8' }],
  ['/favicon.svg', { filename: '../../web/favicon.svg', mime: 'image/svg+xml' }],
]);

const securityHeaders = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

/** @param {import('node:http').ServerResponse} response @param {number} code @param {object} data */
export function sendJson(response, code, data) {
  const body = JSON.stringify(data);
  response.writeHead(code, { ...securityHeaders, 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

/** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
export async function handleRequest(request, response, { persistence = null, auth = null } = {}) {
  let pathname;
  try {
    pathname = new URL(request.url ?? '/', 'http://domyro.invalid').pathname;
  } catch {
    sendJson(response, 400, { error: 'bad_request' });
    return;
  }
  // Authenticate state-bearing API routes before the GET-only preview fallback.
  if (auth && await auth.route(request, response, pathname)) return;
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.setHeader('allow', 'GET, HEAD');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (pathname === '/api/v1/health/live') {
    sendJson(response, 200, { status: 'alive', service: 'domyro-core' });
    return;
  }
  if (pathname === '/api/v1/health/ready') {
    const db = persistence ? await persistence.inspect() : { ready: false, reason: 'persistence_not_configured' };
    // Authentication and secure onboarding are not implemented. Database alone
    // never makes this development preview ready for production or commands.
    sendJson(response, 503, { status: 'not_ready', reason: db.ready ? 'authentication_not_configured' : db.reason });
    return;
  }
  if (pathname === '/api/v1/public/status') {
    const db = persistence ? await persistence.inspect() : { ready: false, reason: 'persistence_not_configured' };
    sendJson(response, 200, {
      service: 'Domyro', version: '0.1.0-dev.1', phase: 'foundation',
      core: 'running', persistence: db.ready ? 'ready' : db.reason === 'database_unavailable' ? 'unavailable' : 'not_configured',
      integrations: 'not_configured', devices: 'not_connected',
      productionReady: false,
    });
    return;
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/ws/')) {
    sendJson(response, 404, { error: 'not_implemented' });
    return;
  }
  const asset = assets.get(pathname);
  if (!asset) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  try {
    const contents = await readFile(fileURLToPath(new URL(asset.filename, import.meta.url)));
    response.writeHead(200, {
      ...securityHeaders,
      'cache-control': pathname === '/' || pathname === '/index.html' ? 'no-store' : 'public, max-age=300',
      'content-type': asset.mime,
      'content-length': contents.byteLength,
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    sendJson(response, 500, { error: 'internal_error' });
  }
}

/** Validate local config; network exposure must be an explicit administrator choice. */
export function readListenOptions(env = process.env) {
  const rawPort = env.DOMYRO_PORT ?? '8844';
  if (!/^\d+$/.test(rawPort)) throw new Error('DOMYRO_PORT must be a valid integer');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('DOMYRO_PORT out of range');
  const host = env.DOMYRO_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)) {
    throw new Error('DOMYRO_HOST must be an explicit local bind address (127.0.0.1, ::1, 0.0.0.0 or ::)');
  }
  return { host, port };
}
