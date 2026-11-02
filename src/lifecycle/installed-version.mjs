// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One canonical installed version for HTTP status, authenticated update
 * advice and public release discovery. Every native release ships its own
 * root package.json, signed with the rest of the exact source bundle.
 */
import { readFileSync } from 'node:fs';
import { compareVersions } from './release.mjs';

export function validateInstalledPackage(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     data.name!=='domyro'||typeof data.version!=='string'||
     data.version.length>80){
    throw new Error('installed_version_manifest_invalid');
  }
  try{compareVersions(data.version,data.version);}
  catch{throw new Error('installed_version_manifest_invalid');}
  return data.version;
}

export const INSTALLED_VERSION=validateInstalledPackage(
  JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'))
);
