// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { handleRequest, readListenOptions } from './lib/http.mjs';

/**
 * HTTP foundation: optional real PostgreSQL readiness, but NO auth or device
 * control until the secure owner onboarding and session layers are implemented.
 */
export function createDomyroServer({ persistence = null } = {}) {
  const server = createServer((req, res) => {
    handleRequest(req, res, { persistence }).catch(() => {
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
  const server = createDomyroServer({ persistence });
  server.on('error', () => {
    console.error('Domyro HTTP listener could not start. Check the requested local host and port.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Domyro development preview running at http://${host === '::' ? '[::]' : host}:${port}`);
    console.log('NOT production ready: authentication and device control are not implemented.');
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
