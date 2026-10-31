// SPDX-License-Identifier: AGPL-3.0-only
/** State truth helpers. Never confuse a requested value with observed hardware state. */
export const OBSERVATION_QUALITY = Object.freeze(['confirmed', 'unknown', 'unavailable', 'stale']);

/** @param {{value?:unknown, observedAt?:string, quality?:string}|null} observation */
export function normalizeObservation(observation) {
  if (!observation || !OBSERVATION_QUALITY.includes(observation.quality ?? '')) {
    return { quality: 'unknown', value: null, observedAt: null };
  }
  if (observation.quality === 'unknown' || observation.quality === 'unavailable') {
    return { quality: observation.quality, value: null, observedAt: observation.observedAt ?? null };
  }
  const observedAt = observation.observedAt;
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    return { quality: 'unknown', value: null, observedAt: null };
  }
  return { quality: observation.quality, value: observation.value ?? null, observedAt };
}

/**
 * @param {{observation?:unknown,pendingCommand?:{value?:unknown}|null}} entity
 */
export function displayState(entity) {
  const observed = normalizeObservation(entity?.observation ?? null);
  return {
    observed,
    pending: entity?.pendingCommand != null,
    requestedValue: entity?.pendingCommand?.value ?? null,
  };
}
