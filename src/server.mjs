// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { handleRequest, readListenOptions } from './lib/http.mjs';

/**
 * HTTP foundation: optional real PostgreSQL readiness, but NO auth or device
 * control until the secure owner onboarding and session layers are implemented.
 */
export function createDomyroServer({ persistence = null, auth = null } = {}) {
  const server = createServer((req, res) => {
    handleRequest(req, res, { persistence, auth }).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      if (!res.writableEnded) res.end('{"error":"internal_error"}');
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}

async function start() {
  const { host, port } = readListenOptions();
  const { createPersistence } = await import('./persistence/pool.mjs');
  const persistence = await createPersistence();
  const { createLocalAuthService } = await import('./security/http-auth.mjs');
  const { sendJson } = await import('./lib/http.mjs');
  // Never enable development login on a LAN/WAN bind. HTTPS, trusted proxies,
  // account recovery and MFA are still required before real deployments.
  const localAuth = persistence && ['127.0.0.1', '::1'].includes(host)
    ? await createLocalAuthService(persistence.db, sendJson) : null;
  const server = createDomyroServer({ persistence, auth: localAuth });
  server.on('error', () => {
    console.error('Domyro HTTP listener could not start. Check the requested local host and port.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Domyro development preview running at http://${host === '::' ? '[::]' : host}:${port}`);
    console.log('NOT production ready: authentication hardening, recovery and device control remain incomplete.');
    if (localAuth) console.log('Loopback-only experimental login enabled. Console bootstrap required.');
    if (persistence) console.log('PostgreSQL configured. Database migrations are never performed automatically.');
    if (host === '0.0.0.0' || host === '::') console.warn('WARNING: exposed network bind without login. Use only an isolated test network.');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(async () => {
      if (persistence) await persistence.close();
    }));
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) start().catch(() => {
  console.error('Domyro development preview startup failed. No database or host changes were made.');
  process.exitCode = 1;
});
