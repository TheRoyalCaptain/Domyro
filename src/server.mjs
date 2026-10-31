// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { handleRequest, readListenOptions } from './lib/http.mjs';

export function createDomyroServer() {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
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

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { host, port } = readListenOptions();
  const server = createDomyroServer();
  server.listen(port, host, () => {
    console.log(`Domyro 0.1 foundation running at http://${host === '::' ? '[::]' : host}:${port}`);
    console.log('Development-only server: no database, login or device control configured.');
    if (host === '0.0.0.0' || host === '::') {
      console.warn('WARNING: Listening on all interfaces. No authentication is implemented; keep behind a trusted firewall.');
    }
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}
