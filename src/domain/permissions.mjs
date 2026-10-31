// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure, deny-by-default authorization primitives for the future domain API.
 * Nothing in this file authenticates a session or grants an HTTP endpoint access.
 */
const rolePermissions = Object.freeze({
  owner: ['view', 'control', 'configure', 'admin'],
  admin: ['view', 'control', 'configure', 'admin'],
  manager: ['view', 'control', 'configure'],
  resident: ['view', 'control'],
  guest: ['view'],
});

/**
 * @param {{ userId?: string, siteId?: string, memberships?: Array<{userId: string, siteId: string, role: string}> }} identity
 * @param {{ siteId?: string, permission?: string }} request
 */
export function mayAccessSite(identity, request) {
  if (!identity || !request || !identity.userId || !request.siteId || !request.permission) return false;
  if (!Array.isArray(identity.memberships)) return false;
  const membership = identity.memberships.find(
    (entry) => entry.userId === identity.userId && entry.siteId === request.siteId,
  );
  if (!membership) return false;
  return (rolePermissions[membership.role] ?? []).includes(request.permission);
}

export function getKnownRoles() {
  return Object.keys(rolePermissions);
}
