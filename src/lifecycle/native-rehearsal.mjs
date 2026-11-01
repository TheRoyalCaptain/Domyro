// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Boot a signed Domyro source bundle in a disposable test directory.
 * No host installation, apt, systemd, PostgreSQL or smart-home devices.
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir, arch as hostArch } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stageVerifiedBundle } from './transactional-release.mjs';
import { renderNativeSystemdDraft } from './native-install-plan.mjs';

const ARCH = Object.freeze({ x64:'amd64', arm64:'arm64' });
const TIMEOUT = 8_000;

async function listen(server) {
  await new Promise((resolve, reject) => {
    function failed(error) { server.off('error', failed); reject(error); }
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      resolve();
    });
  });
  const address = server.address();
  if (!address || address.address !== '127.0.0.1') {
    throw new Error('non_loopback_rehearsal_not_allowed');
  }
  return 'http://127.0.0.1:' + address.port;
}
async function closeServer(server) {
  if (!server.listening) return;
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
async function get(url) {
  return fetch(url, {
    redirect:'error',
    signal:AbortSignal.timeout(TIMEOUT),
    headers:{accept:'application/json, text/html'},
  });
}

/**
 * Stage a signed artifact and boot its real HTTP server on an ephemeral port.
 * CI-only beforeProbe is a failure-injection hook, not deployment consent.
 */
export async function rehearseNativeBundle({
  manifestBytes, signatureBase64, trustedPublicKeyPem, artifactBytes,
  arch = ARCH[hostArch()], beforeProbe = async () => {},
} = {}) {
  if (arch !== ARCH[hostArch()]) throw new Error('native_architecture_mismatch');
  if (typeof beforeProbe !== 'function') throw new TypeError('invalid_rehearsal_hook');
  const sandbox = await mkdtemp(join(tmpdir(), 'domyro-native-rehearsal-'));
  let server = null;
  try {
    const root = join(sandbox, 'release-store');
    const staged = await stageVerifiedBundle({
      root,manifestBytes,signatureBase64,trustedPublicKeyPem,artifactBytes,arch,
    });
    const directory = join(root, 'releases', staged.version);
    const project = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (project.name !== 'domyro') throw new Error('invalid_project_identity');
    const unitDraft = renderNativeSystemdDraft({port:8844});
    if (!unitDraft.includes('DOMYRO_HOST=127.0.0.1')) throw new Error('native_unit_not_loopback');
    await beforeProbe({sandbox,release:directory});
    const entry = pathToFileURL(join(directory,'src/server.mjs')).href;
    const app = await import(entry);
    if (typeof app.createDomyroServer !== 'function') throw new Error('server_entry_missing');
    server = app.createDomyroServer({persistence:null,auth:null});
    const base = await listen(server);
    const live = await get(base+'/api/v1/health/live');
    if (live.status !== 200 || (await live.json()).status !== 'alive') throw new Error('live_probe_failed');
    const ready = await get(base+'/api/v1/health/ready');
    if (ready.status !== 503 || (await ready.json()).status !== 'not_ready') throw new Error('false_ready_production_status');
    const status = await get(base+'/api/v1/public/status');
    if (status.status !== 200 || (await status.json()).productionReady !== false) throw new Error('false_production_status');
    const login = await get(base+'/login');
    if (login.status !== 200 || !(await login.text()).includes('Domyro')) throw new Error('login_asset_missing');
    const files=['/assets/app.js','/assets/login.js','/assets/styles.css','/assets/login.css'];
    for (const asset of files) {
      const response = await get(base+asset);
      if (response.status !== 200) throw new Error('static_asset_missing');
    }
    return Object.freeze({
      result:'isolated_http_smoke_passed',testedRelease:staged.version,
      testedArch:arch,endpointsChecked:8,productionReady:false,
      installationApproved:false,systemServiceInstalled:false,
      databaseMigrated:false,externalDevicesAccessed:false,
      sandboxRemovedAfterTest:true,gate:'D-53',
    });
  } finally {
    if (server) await closeServer(server);
    await rm(sandbox,{recursive:true,force:true});
  }
}
