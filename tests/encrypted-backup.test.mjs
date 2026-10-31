// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackupBytes, decryptBackupBytes } from '../src/lifecycle/encrypted-backup.mjs';

test('authenticated snapshot encryption round-trips isolated sample bytes and uses a unique salt/nonce', async () => {
  const password = 'local-test-passphrase-never-use-as-production-credential';
  const plaintext = Buffer.from(JSON.stringify({ sample: true, device: 'none', data: [0, 5, 9] }));
  const a = await encryptBackupBytes(plaintext, password);
  const b = await encryptBackupBytes(plaintext, password);
  assert.notDeepEqual(a, b);
  assert.deepEqual(await decryptBackupBytes(a, password), plaintext);
  assert.deepEqual(await decryptBackupBytes(b, password), plaintext);
  assert.equal(a.toString('utf8').includes('local-test-passphrase'), false);
});

test('wrong key, tampering and invalid inputs fail closed', async () => {
  const a = await encryptBackupBytes(Buffer.from('fake backup only, no PostgreSQL content'), 'correct-long-test-password');
  await assert.rejects(() => decryptBackupBytes(a, 'wrong-but-long-password'), /backup_authentication_failed/);
  const tampered = Buffer.from(a);
  tampered[tampered.length - 17] ^= 1;
  await assert.rejects(() => decryptBackupBytes(tampered, 'correct-long-test-password'), /backup_authentication_failed/);
  const tamperedHeader = Buffer.from(a);
  tamperedHeader[24] ^= 1;
  await assert.rejects(() => decryptBackupBytes(tamperedHeader, 'correct-long-test-password'));
  await assert.rejects(() => encryptBackupBytes(Buffer.alloc(0), 'correct-long-test-password'), /backup_input_invalid/);
  await assert.rejects(() => encryptBackupBytes(Buffer.from('data'), 'weak'), /backup_password_policy/);
  await assert.rejects(() => decryptBackupBytes(Buffer.from('nonsense'), 'correct-long-test-password'), /backup_format_invalid/);
});
