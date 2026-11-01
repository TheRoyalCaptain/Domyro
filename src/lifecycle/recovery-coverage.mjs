// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recovery coverage REQUIREMENTS evaluator, not a recovery engine.
 * This is an inventory/contract only. Caller-reported test flags must never
 * authorize a production upgrade or release without independent evidence.
 */
export const RECOVERY_COMPONENTS = Object.freeze([
  Object.freeze({ id: 'postgresql', mandatory: true }),
  Object.freeze({ id: 'domyro_config', mandatory: true }),
  Object.freeze({ id: 'auth_and_recovery_keys', mandatory: true }),
  Object.freeze({ id: 'uploads', mandatory: false }),
  Object.freeze({ id: 'mosquitto', mandatory: false }),
  Object.freeze({ id: 'zigbee2mqtt', mandatory: false }),
  Object.freeze({ id: 'matter_fabrics', mandatory: false }),
]);
const VALUES = new Set(['not-configured', 'managed', 'external']);
function isBoolean(v) { return v === true || v === false; }

/**
 * A managed integration must be included in a coordinated recovery set.
 * An external integration must come with external recovery evidence; it is
 * NOT automatically safe simply because Domyro doesn't own the service.
 */
export function assessRecoveryCoverage(rows) {
  if (!Array.isArray(rows) || rows.length !== RECOVERY_COMPONENTS.length) throw new TypeError('invalid_recovery_inventory');
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || map.has(row.id) ||
        !VALUES.has(row.ownership) ||
        !['missing', 'captured', 'externally-verified', 'not-applicable'].includes(row.snapshot) ||
        !isBoolean(row.decryptedAndChecked) || !isBoolean(row.restoredInScratch) ||
        !isBoolean(row.coordinated) || !isBoolean(row.includesSecrets)) throw new TypeError('invalid_recovery_component');
    map.set(row.id, row);
  }
  const blockers = [], details = [];
  for (const component of RECOVERY_COMPONENTS) {
    const row = map.get(component.id);
    if (!row) throw new TypeError('missing_recovery_component_' + component.id);
    let reason = null;
    if (row.ownership === 'not-configured') {
      if (component.mandatory || row.snapshot !== 'not-applicable' ||
          row.decryptedAndChecked || row.restoredInScratch ||
          row.coordinated || row.includesSecrets) reason = 'invalid_not_configured';
    } else if (row.ownership === 'external') {
      if (row.snapshot !== 'externally-verified' || !row.restoredInScratch ||
          !row.coordinated) reason = 'external_restore_not_proven';
    } else if (row.snapshot !== 'captured' || !row.decryptedAndChecked ||
        !row.restoredInScratch || !row.coordinated) {
      reason = 'managed_restore_not_proven';
    }
    if (['domyro_config', 'auth_and_recovery_keys', 'matter_fabrics', 'zigbee2mqtt'].includes(component.id) &&
        row.ownership === 'managed' && !row.includesSecrets) reason = 'component_secrets_uncovered';
    if (reason) blockers.push(Object.freeze({ component: component.id, reason }));
    details.push(Object.freeze({ component: component.id, ownership: row.ownership,
      assessed: !reason, reason }));
  }
  return Object.freeze({
    // Contract coverage only, never an independent signoff.
    contractCoverageComplete: blockers.length === 0,
    productionRestoreApproved: false,
    blockers: Object.freeze(blockers), components: Object.freeze(details),
  });
}

/** Default expected coverage of the current repository, with NO false claims. */
export function currentDevelopmentRecoveryCoverage() {
  const rows = RECOVERY_COMPONENTS.map(({ id, mandatory }) => ({
    id, ownership: mandatory ? 'managed' : 'not-configured',
    snapshot: mandatory ? 'missing' : 'not-applicable',
    decryptedAndChecked: false, restoredInScratch: false,
    coordinated: false, includesSecrets: false,
  }));
  return assessRecoveryCoverage(rows);
}
