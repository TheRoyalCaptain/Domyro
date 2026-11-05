// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Verify an official release signing key WITHOUT ever storing its private
 * component in git. This is a policy verifier; publishing requires a distinct
 * human-approved environment and all D-53 checks.
 */
import { createHash,createPrivateKey,createPublicKey } from 'node:crypto';

const FINGERPRINT=/^[a-f0-9]{64}$/;
const RELEASE_SOURCE='github.com/TheRoyalCaptain/Domyro/releases';
export function validatePublisherTrustPolicy({policy,privateKeyPem}={}){
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||
     policy.schemaVersion!==1||policy.configured!==true||
     policy.releaseSource!==RELEASE_SOURCE||
     typeof policy.publicKeyPem!=='string'||
     !FINGERPRINT.test(policy.publisherFingerprintSha256??'')){
    throw new Error('official_publisher_not_configured');
  }
  const pub=createPublicKey(policy.publicKeyPem);
  if(pub.asymmetricKeyType!=='ed25519')throw new Error('publisher_ed25519_key_required');
  const fingerprint=createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex');
  if(fingerprint!==policy.publisherFingerprintSha256){
    throw new Error('publisher_trust_fingerprint_mismatch');
  }
  if(typeof privateKeyPem==='string'){
    const priv=createPrivateKey(privateKeyPem);
    if(priv.asymmetricKeyType!=='ed25519')throw new Error('publisher_signer_ed25519_required');
    const actual=createPublicKey(priv).export({type:'spki',format:'der'});
    const pinned=pub.export({type:'spki',format:'der'});
    if(!actual.equals(pinned))throw new Error('publisher_private_key_does_not_match_pinned_public_key');
  }
  return Object.freeze({configured:true,releaseSource:RELEASE_SOURCE,
    publisherFingerprintSha256:fingerprint,signerMatchesPolicy:typeof privateKeyPem==='string',
    installationApproved:false,gate:'D-53'});
}
