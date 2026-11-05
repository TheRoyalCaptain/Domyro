// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Experimental Zigbee2MQTT command *protocol* controller.
 *
 * No HTTP route, no automatic startup, no owner-server broker credentials.
 * The caller must supply a publisher; our existing preview remains read-only.
 * A transport QoS1 ACK is NOT proof of device actuation. Only a subsequent,
 * non-retained observation from the SAME stable IEEE identity confirms.
 */
const IEEE=/^0x[0-9a-f]{16}$/i;
const FIELDS=new Set(['state','brightness']);
const FRESH_MS=60_000;
const COOLDOWN_MS=750;
const CONTROL_TIMEOUT_MIN=250;
const CONTROL_TIMEOUT_MAX=20_000;

function validValue(field, value, descriptor){
  if(field==='state')return typeof value==='boolean' && descriptor.kind==='boolean';
  if(field==='brightness')return Number.isInteger(value) && descriptor.kind==='integer' &&
    Number.isInteger(descriptor.min)&&Number.isInteger(descriptor.max)&&
    value>=descriptor.min&&value<=descriptor.max&&
    Number.isInteger(descriptor.step)&&descriptor.step>0&&
    (value-descriptor.min)%descriptor.step===0;
  return false;
}
function requestedPayload(field,value){
  if(field==='state')return JSON.stringify({state:value?'ON':'OFF'});
  return JSON.stringify({brightness:value});
}
function findDevice(snapshot,id){
  return snapshot?.devices?.find(item=>item.id===id)??null;
}
function eligible(snapshot,id,field,value,clock){
  if(snapshot?.transport!=='connected'||snapshot?.bridge!=='online'){
    throw new Error('zigbee_control_transport_offline');
  }
  const device=findDevice(snapshot,id);
  if(!device||device.supported!==true||device.available!==true){
    throw new Error('zigbee_control_device_unavailable');
  }
  const control=device.controls?.[field];
  if(!control||control.read!==true||control.write!==true||!validValue(field,value,control)){
    throw new Error('zigbee_control_capability_denied');
  }
  const observation=device.observations?.[field];
  const stamp=Date.parse(observation?.observedAt??'');
  if(observation?.quality!=='confirmed'||!Number.isFinite(stamp)||
    stamp>clock||clock-stamp>FRESH_MS){
    throw new Error('zigbee_control_fresh_state_required');
  }
  if(typeof device.friendlyName!=='string'||
    device.friendlyName.length>128||
    device.friendlyName.split('/').some(x=>!x||x==='.'||x==='..'||x==='bridge')||
    /[+#\u0000-\u001f\u007f]/.test(device.friendlyName)){
    throw new Error('zigbee_control_topic_unsafe');
  }
  return {device,observation,observedAt:stamp};
}
/**
 * A single in-flight command, no queue, retries, bulk control, toggle, groups,
 * covers, locks, climate or retained MQTT publishes.
 * Calling this API is NOT equivalent to authorization: future production
 * endpoints must add session/site role checks and audited operator consent.
 */
export function createZigbee2MqttCommandController({
  preview, publish, baseTopic='zigbee2mqtt', now=Date.now,
}={}){
  if(!preview||typeof preview.snapshot!=='function'||
    typeof preview.subscribeUpdates!=='function'||typeof publish!=='function'||
    typeof now!=='function'||
    !/^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64}){0,3}$/.test(baseTopic)||
    baseTopic.split('/').includes('bridge')){
    throw new TypeError('zigbee_control_dependencies_invalid');
  }
  let pending=null,disposed=false;
  const cooldown=new Map();
  return Object.freeze({
    async command({deviceId,field,value,confirmedByOperator=false,timeoutMs=5000}={}){
      if(disposed)throw new Error('zigbee_control_disposed');
      if(confirmedByOperator!==true)throw new Error('zigbee_control_explicit_confirmation_required');
      if(typeof deviceId!=='string'||!IEEE.test(deviceId)||
        !FIELDS.has(field)||!Number.isSafeInteger(timeoutMs)||
        timeoutMs<CONTROL_TIMEOUT_MIN||timeoutMs>CONTROL_TIMEOUT_MAX){
        throw new TypeError('zigbee_control_request_invalid');
      }
      if(pending)throw new Error('zigbee_control_in_flight');
      const id=deviceId.toLowerCase(),time=now();
      if(!Number.isFinite(time))throw new Error('zigbee_control_clock_invalid');
      if((cooldown.get(id)??-Infinity)+COOLDOWN_MS>time)throw new Error('zigbee_control_rate_limited');
      const previous=eligible(preview.snapshot(),id,field,value,time);
      if(previous.observation.value===value){
        return Object.freeze({status:'already_confirmed',deviceId:id,field,
          published:false,deviceConfirmed:true});
      }
      const originalName=previous.device.friendlyName;
      const topic=baseTopic+'/'+originalName+'/set';
      const payload=requestedPayload(field,value);
      // Only one pending control even across different devices: prevents
      // conflicting writes and ambiguous snapshots during startup/reconnect.
      let complete,unsubscribe=()=>{},timer,settled=false;
      const outcome=new Promise(resolve=>{
        complete=(status)=>{
          if(settled)return;
          settled=true;clearTimeout(timer);
          unsubscribe();pending=null;
          if(status!=='already_confirmed')cooldown.set(id,now());
          resolve(Object.freeze({
            status,deviceId:id,field,published:status!=='publish_failed',
            deviceConfirmed:status==='confirmed',
          }));
        };
      });
      pending={finish:complete};
      unsubscribe=preview.subscribeUpdates(snapshot=>{
        if(settled)return;
        if(snapshot?.transport!=='connected'||snapshot?.bridge!=='online'){
          complete('transport_lost');return;
        }
        const device=findDevice(snapshot,id);
        if(!device||!device.available||!device.supported){
          complete('device_lost');return;
        }
        if(device.friendlyName!==originalName||
          !device.controls?.[field]?.write){
          complete('device_changed');return;
        }
        const observation=device.observations?.[field];
        const stamp=Date.parse(observation?.observedAt??'');
        // The broker may echo our publish; only a NEW nonretained device state
        // update for the same identity counts. No optimistic UI confirmation.
        if(observation?.quality==='confirmed' && stamp>previous.observedAt &&
          stamp<=now()+5000 && observation.value===value)complete('confirmed');
      });
      timer=setTimeout(()=>complete('not_confirmed'),timeoutMs);
      try{
        // publish is deliberately injected, never auto-created or connected to
        // live Zigbee hardware by this module.
        await publish(topic,payload,{qos:1,retain:false});
      }catch{
        complete('publish_failed');
      }
      return outcome;
    },
    dispose(){
      disposed=true;
      if(pending)pending.finish('cancelled');
    },
    snapshot(){
      return Object.freeze({inFlight:pending!==null,disposed,
        automaticRetries:false,productionReady:false,deviceControlEnabledInServer:false});
    },
  });
}
