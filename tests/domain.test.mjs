// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mayAccessSite, getKnownRoles } from '../src/domain/permissions.mjs';
import { normalizeObservation, displayState } from '../src/domain/state.mjs';

const memberships = [
  { userId: 'alice', siteId: 'home', role: 'owner' },
  { userId: 'bob', siteId: 'home', role: 'guest' },
  { userId: 'bob', siteId: 'office', role: 'manager' },
];

test('deny unknown identities and never fall back across sites', () => {
  assert.equal(mayAccessSite(null, { siteId: 'home', permission: 'view' }), false);
  assert.equal(mayAccessSite({ userId: 'mallory', memberships }, { siteId: 'home', permission: 'view' }), false);
  assert.equal(mayAccessSite({ userId: 'alice', memberships }, { siteId: 'office', permission: 'admin' }), false);
  assert.equal(mayAccessSite({ userId: 'bob', memberships }, { siteId: 'home', permission: 'control' }), false);
  assert.equal(mayAccessSite({ userId: 'bob', memberships }, { siteId: 'home', permission: 'view' }), true);
  assert.equal(mayAccessSite({ userId: 'bob', memberships }, { siteId: 'office', permission: 'configure' }), true);
  assert.equal(mayAccessSite({ userId: 'alice', memberships }, { siteId: 'home', permission: 'admin' }), true);
  assert.equal(getKnownRoles().length, 5);
});

test('requested command state is never reported as confirmed hardware state', () => {
  const view = displayState({ observation: null, pendingCommand: { value: true } });
  assert.equal(view.observed.quality, 'unknown');
  assert.equal(view.observed.value, null);
  assert.equal(view.pending, true);
  assert.equal(view.requestedValue, true);
  assert.deepEqual(normalizeObservation({ quality: 'confirmed', value: 21, observedAt: 'bogus' }), { quality: 'unknown', value: null, observedAt: null });
  assert.deepEqual(normalizeObservation({ quality: 'unavailable', value: 30 }), { quality: 'unavailable', value: null, observedAt: null });
  assert.equal(normalizeObservation({ quality: 'confirmed', value: false, observedAt: '2026-10-31T12:00:00Z' }).value, false);
});
