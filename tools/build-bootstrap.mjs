// SPDX-License-Identifier: AGPL-3.0-only
// Build a standalone installer only from an independently verified release.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectOfflineNativeSourceRelease} from '../src/lifecycle/native-release-verifier.mjs';
import {validatePublisherTrustPolicy} from '../src/lifecycle/publisher-trust-policy.mjs';
import {assessOwnerInstallationGate} from '../scripts/check-installation-gate.mjs';

export async function buildBootstrap({directory,policy,readiness,privateKeyPem}) {
  if(!assessOwnerInstallationGate(readiness).ready)throw Error('installation_gate_closed');
  validatePublisherTrustPolicy({policy,privateKeyPem});
  if(typeof privateKeyPem!=='string')throw Error('bootstrap_signer_required');
  for(const architecture of ['amd64','arm64'])await inspectOfflineNativeSourceRelease({
    directory,architecture,databaseSchema:3,channel:'beta',trustedPublicKeyPem:policy.publicKeyPem,
    expectedPublicKeySha256:policy.publisherFingerprintSha256});
  const manifest=JSON.parse(await readFile(join(directory,'release-manifest.json'),'utf8'));
  if(manifest.channel!=='stable')throw Error('bootstrap_stable_release_required');
  const files={};
  for(const name of ['release-manifest.json','release-manifest.sig',...manifest.artifacts.map(a=>a.file)]){
    const bytes=await readFile(join(directory,name));
    const artifact=manifest.artifacts.find(a=>a.file===name);
    if(artifact&&(bytes.length!==artifact.bytes||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256))
      throw Error('bootstrap_source_changed');
    files[name]=bytes.toString('base64');
  }
  const payload=gzipSync(Buffer.from(JSON.stringify({files,policy,readiness})),{level:9}).toString('base64');
  const metadata={version:manifest.version,channel:manifest.channel,publisherFingerprintSha256:policy.publisherFingerprintSha256};
  const source=`#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Verify this whole file against the independently published SHA-256 BEFORE execution.
import base64, gzip, json, os, platform, subprocess, sys, tempfile
from pathlib import Path, PurePosixPath
METADATA = json.loads(${JSON.stringify(JSON.stringify(metadata))})
PAYLOAD = ${JSON.stringify(payload)}

def main():
    if sys.argv[1:] == ['--inspect']:
        print(json.dumps(METADATA, sort_keys=True))
        return
    if sys.argv[1:] != ['--install']:
        raise ValueError('explicit_install_required')
    if os.geteuid() != 0:
        raise ValueError('root_required')
    architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    if not architecture:
        raise ValueError('unsupported_architecture')
    data = json.loads(gzip.decompress(base64.b64decode(PAYLOAD, validate=True)))
    with tempfile.TemporaryDirectory(prefix='domyro-bootstrap-') as tmp:
        root = Path(tmp)
        package = root / 'package'
        package.mkdir(mode=0o700)
        for name, encoded in data['files'].items():
            if PurePosixPath(name).name != name or name in ('.', '..'):
                raise ValueError('invalid_package_path')
            path = package / name
            with path.open('xb') as out:
                out.write(base64.b64decode(encoded, validate=True))
            path.chmod(0o600)
        manifest = json.loads((package / 'release-manifest.json').read_text())
        selected = next(a for a in manifest['artifacts'] if a['arch'] == architecture)
        bundle = json.loads((package / selected['file']).read_bytes())
        source = root / 'source'
        source.mkdir(mode=0o700)
        for entry in bundle['files']:
            path = PurePosixPath(entry['path'])
            if path.is_absolute() or '..' in path.parts or not path.parts:
                raise ValueError('invalid_source_path')
            target = source / path
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open('xb') as out:
                out.write(base64.b64decode(entry['base64'], validate=True))
            target.chmod(0o600)
        for name, value in [('publisher', data['policy']), ('readiness', data['readiness'])]:
            target = root / (name + '.json')
            with target.open('x') as out:
                json.dump(value, out)
            target.chmod(0o600)
        # The bootstrap bytes are trusted via the externally pinned hash.
        # The native installer independently rechecks package signatures.
        subprocess.run([sys.executable, str(source / 'scripts/install-native.py'), '--install',
            '--directory=' + str(package), '--publisher-policy=' + str(root / 'publisher.json'),
            '--readiness=' + str(root / 'readiness.json')], check=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Domyro standalone installer failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
`;
  const bytes=Buffer.from(source),sha256=createHash('sha256').update(bytes).digest('hex');
  const signature=sign(null,bytes,privateKeyPem).toString('base64')+'\n';
  const url='https://github.com/TheRoyalCaptain/Domyro/releases/download/v'+manifest.version+'/domyro-install.py';
  const command=`(set -eu; f=$(mktemp); trap 'rm -f "$f"' EXIT; curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 180 '${url}' -o "$f"; printf '%s  %s\\n' '${sha256}' "$f" | sha256sum -c -; sudo python3 "$f" --install)`;
  return {bytes,sha256,signature,command,metadata};
}
export async function writeBootstrap(directory,result){
  await mkdir(directory,{recursive:true,mode:0o700});
  for(const [name,content] of Object.entries({'domyro-install.py':result.bytes,
    'domyro-install.py.sha256':result.sha256+'  domyro-install.py\n',
    'domyro-install.py.sig':result.signature,
    'INSTALL.txt':'Ubuntu 24.04 AMD64/ARM64; Python 3.12, CA certificates, curl and sudo required.\nVerify the checksum via an independent trusted channel before execution.\n\n'+result.command+'\n'}))
    await writeFile(join(directory,name),content,{flag:'wx',mode:0o600});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==7)throw Error('usage: build-bootstrap.mjs directory output publisher-policy readiness private-key');
    const [, ,directory,output,policyFile,readinessFile,keyFile]=process.argv;
    const result=await buildBootstrap({directory:resolve(directory),policy:JSON.parse(await readFile(policyFile,'utf8')),
      readiness:JSON.parse(await readFile(readinessFile,'utf8')),privateKeyPem:await readFile(keyFile,'utf8')});
    await writeBootstrap(output,result);
    console.log('Standalone installer built; publication and owner installation are separate actions.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
