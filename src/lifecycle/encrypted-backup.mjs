// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Standalone binary encryption primitive for future verified backups.
 * Not yet integrated with PostgreSQL, storage destinations or the native installer.
 * This function is NOT proof that a restorable database backup exists.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const MAGIC = Buffer.from('DOMYROB1', 'ascii');
const MAX_PLAINTEXT = 32 * 1024 * 1024;
const MAX_HEADER = 4096;
const KDF = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

async function deriveKey(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('backup_password_policy');
  return scrypt(password, salt, 32, KDF);
}

function validatedHeader(header) {
  if (!header || header.schemaVersion !== 1 || header.algorithm !== 'aes-256-gcm' || header.kdf !== 'scrypt' || header.N !== KDF.N || header.r !== KDF.r || header.p !== KDF.p) throw new Error('backup_header_unsupported');
  if (typeof header.salt !== 'string' || !/^[a-f0-9]{64}$/.test(header.salt) || typeof header.iv !== 'string' || !/^[a-f0-9]{24}$/.test(header.iv)) throw new Error('backup_header_invalid');
  if (typeof header.createdAt !== 'string' || !Number.isFinite(Date.parse(header.createdAt))) throw new Error('backup_timestamp_invalid');
  if (!Number.isSafeInteger(header.plaintextBytes) || header.plaintextBytes < 0 || header.plaintextBytes > MAX_PLAINTEXT) throw new Error('backup_size_invalid');
  return header;
}

/** Creates a self-contained authenticated encrypted byte container (no filesystem effects). */
export async function encryptBackupBytes(plaintext, password) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length < 1 || plaintext.length > MAX_PLAINTEXT) throw new Error('backup_input_invalid');
  const salt = randomBytes(32), iv = randomBytes(12);
  const header = {
    schemaVersion: 1, algorithm: 'aes-256-gcm', kdf: 'scrypt',
    N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('hex'), iv: iv.toString('hex'),
    plaintextBytes: plaintext.length, createdAt: new Date().toISOString(),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.length > MAX_HEADER) throw new Error('backup_header_too_large');
  const key = await deriveKey(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.concat([MAGIC, headerBytes]));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.length, 0);
    return Buffer.concat([MAGIC, length, headerBytes, encrypted, cipher.getAuthTag()]);
  } finally { key.fill(0); }
}

/** Decrypts only after successful GCM authentication, never writes to disk. */
export async function decryptBackupBytes(blob, password) {
  if (!Buffer.isBuffer(blob) || blob.length < MAGIC.length + 4 + 16 || blob.length > MAX_PLAINTEXT + MAX_HEADER + 1024) throw new Error('backup_format_invalid');
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('backup_magic_invalid');
  const headerLen = blob.readUInt32BE(MAGIC.length);
  const offset = MAGIC.length + 4;
  if (headerLen < 1 || headerLen > MAX_HEADER || blob.length < offset + headerLen + 16) throw new Error('backup_header_length_invalid');
  const headerBytes = blob.subarray(offset, offset + headerLen);
  let header;
  try { header = validatedHeader(JSON.parse(headerBytes.toString('utf8'))); }
  catch { throw new Error('backup_header_invalid'); }
  const start = offset + headerLen, tagStart = blob.length - 16;
  if (tagStart - start !== header.plaintextBytes) throw new Error('backup_length_invalid');
  const key = await deriveKey(password, Buffer.from(header.salt, 'hex'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'));
    decipher.setAAD(Buffer.concat([MAGIC, headerBytes]));
    decipher.setAuthTag(blob.subarray(tagStart));
    try { return Buffer.concat([decipher.update(blob.subarray(start, tagStart)), decipher.final()]); }
    catch { throw new Error('backup_authentication_failed'); }
  } finally { key.fill(0); }
}
