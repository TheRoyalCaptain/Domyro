// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Narrow Zigbee2MQTT control-capability parser. Do not infer write permission
 * from a state value or from "supported": the bridge/devices exposes bitmask
 * must independently advertise both read AND write for every field.
 *
 * Initial controls intentionally limited to a single-endpoint switch/light
 * state and light brightness. No lock, cover, climate, group, pairing, toggle,
 * configuration, multi-endpoint or arbitrary Zigbee/MQTT command support.
 */
function featureAllowed(item, type, property) {
  return item && typeof item==='object' && !Array.isArray(item) &&
    item.type===type && item.name===property && item.property===property &&
    !Object.hasOwn(item,'endpoint') &&
    (!Object.hasOwn(item,'category') || item.category===undefined) &&
    Number.isSafeInteger(item.access) && (item.access & 3)===3 &&
    (item.access & ~7)===0;
}
function booleanFeature(feature) {
  return featureAllowed(feature,'binary','state') &&
    feature.value_on==='ON' && feature.value_off==='OFF';
}
function brightnessFeature(feature) {
  return featureAllowed(feature,'numeric','brightness') &&
    Number.isSafeInteger(feature.value_min) && Number.isSafeInteger(feature.value_max) &&
    feature.value_min>=0 && feature.value_max<=254 &&
    feature.value_max>feature.value_min &&
    (feature.value_step===undefined ||
      (Number.isSafeInteger(feature.value_step) &&
      feature.value_step>=1 && feature.value_step<=254));
}
/** Do not parse nested endpoints or unsafe generic write-capabilities. */
export function parseSafeZigbeeControls(raw) {
  if (!Array.isArray(raw) || raw.length>64) return Object.freeze({});
  const hits={state:[],brightness:[]};
  for(const expose of raw){
    if(!expose || typeof expose!=='object' || Array.isArray(expose))continue;
    if(!['light','switch'].includes(expose.type) ||
      Object.hasOwn(expose,'endpoint') || expose.category !== undefined ||
      !Array.isArray(expose.features) || expose.features.length>24)continue;
    for(const feature of expose.features){
      if(booleanFeature(feature))hits.state.push(feature);
      if(expose.type==='light' && brightnessFeature(feature))hits.brightness.push(feature);
    }
  }
  const controls={};
  // Ambiguous duplicated feature/property must fail closed, not choose one.
  if(hits.state.length===1)controls.state=Object.freeze({kind:'boolean',read:true,write:true});
  if(hits.brightness.length===1)controls.brightness=Object.freeze({
    kind:'integer',read:true,write:true,
    min:hits.brightness[0].value_min,max:hits.brightness[0].value_max,
    step:hits.brightness[0].value_step??1,
  });
  return Object.freeze(controls);
}
