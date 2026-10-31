// SPDX-License-Identifier: AGPL-3.0-only
/** Dry-run-only native Ubuntu per-service decision validation (D-41). */
const SERVICE_IDS = ['postgresql', 'mosquitto', 'zigbee2mqtt', 'matter-server'];
const ALLOWED_CHOICES = ['managed', 'external', 'defer'];
const MANDATORY = new Set(['postgresql']);

/**
 * Produce a non-mutating plan; privileged operations require a separately
 * authenticated, narrowly scoped installer not implemented here.
 */
export function planSupportingServices(decisions, existingServices = []) {
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions) || !Array.isArray(existingServices)) throw new TypeError('invalid_install_inputs');
  if (Object.keys(decisions).some(k => !SERVICE_IDS.includes(k))) throw new Error('unknown_service');
  const existingById = new Map();
  for (const service of existingServices) {
    if (!service || !SERVICE_IDS.includes(service.id) || existingById.has(service.id) || typeof service.managedByDomyro !== 'boolean' || typeof service.running !== 'boolean') throw new Error('invalid_existing_service');
    existingById.set(service.id, service);
  }
  const problems = [], steps = [];
  for (const id of SERVICE_IDS) {
    const choice = decisions[id];
    if (!ALLOWED_CHOICES.includes(choice)) { problems.push({ service: id, reason: 'choice_required' }); continue; }
    if (MANDATORY.has(id) && choice === 'defer') { problems.push({ service: id, reason: 'required_service_cannot_be_deferred' }); continue; }
    const found = existingById.get(id);
    if (choice === 'managed' && found && !found.managedByDomyro) {
      problems.push({ service: id, reason: 'existing_service_not_owned' }); continue;
    }
    if (choice === 'external' && (!found || !found.running)) {
      problems.push({ service: id, reason: 'external_service_not_available' }); continue;
    }
    steps.push(Object.freeze({ id, action: choice === 'managed' ? found ? 'retain_owned_service' : 'propose_managed_install' : choice === 'external' ? 'connect_existing' : 'skip_optional' }));
  }
  return Object.freeze({ valid: problems.length === 0, steps: Object.freeze(steps), problems: Object.freeze(problems), sideEffects: false });
}
