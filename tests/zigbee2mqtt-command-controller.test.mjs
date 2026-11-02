// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createZigbee2MqttCommandController } from '../src/integrations/zigbee2mqtt-command-controller.mjs';

const id='0x00158d00018255df',topic='zigbee2mqtt/living/plug/set';
const now=Date.now;
function mockPreview({state=false,field='state',controls=null,quality='confirmed'}={}){
  const listeners=new Set();
  let last=Date.now()-1000;
  const defaultControls={state:{kind:'boolean',read:true,write:true}};
  let snapshot={
    transport:'connected',bridge:'online',
    devices:[{
      id,friendlyName:'living/plug',supported:true,available:true,
      controls:controls??defaultControls,
      observations:{[field]:{value:state,quality,observedAt:new Date(last).toISOString()}},
    }],
  };
  return {
    snapshot:()=>snapshot,
    subscribeUpdates(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
    emit(next){
      snapshot=next;
      for(const fn of [...listeners])fn(snapshot);
    },
    patch(changes){
      const orig=snapshot.devices[0],device={
        ...orig,...changes,observations:changes.observations??orig.observations,
      };
      this.emit({...snapshot,devices:[device]});
    },
    observations(value,{quality='confirmed',at=Date.now()}={}){
      this.patch({observations:{
        ...snapshot.devices[0].observations,
        [field]:{value,quality,observedAt:new Date(at).toISOString()},
      }});
    },
    goOffline(){
      this.emit({...snapshot,transport:'disconnected',bridge:'offline'});
    },
    subscribers:()=>listeners.size,
  };
}
test('explicit confirmed operator action is the ONLY write entry point',async()=>{
  const preview=mockPreview(),published=[];
  const driver=createZigbee2MqttCommandController({
    preview,publish:async(...args)=>published.push(args),
  });
  await assert.rejects(driver.command({deviceId:id,field:'state',value:true}),
    /explicit_confirmation_required/);
  await assert.rejects(driver.command({deviceId:id,field:'state',value:'TOGGLE',confirmedByOperator:true}),
    /capability_denied/);
  await assert.rejects(driver.command({deviceId:id,field:'temperature',value:20,confirmedByOperator:true}),
    /request_invalid/);
  await assert.rejects(driver.command({deviceId:'zigbee2mqtt/bridge/request/permit_join',field:'state',
    value:true,confirmedByOperator:true}),/request_invalid/);
  assert.equal(published.length,0);
  driver.dispose();
  await assert.rejects(driver.command({deviceId:id,field:'state',value:true,confirmedByOperator:true}),
    /disposed/);
});
test('ack requires NEW non-retained actual observation, not publisher QoS1 success',async()=>{
  const preview=mockPreview(),writes=[];
  const controller=createZigbee2MqttCommandController({
    preview,publish:async(...args)=>{writes.push(args);},
  });
  const pending=controller.command({deviceId:id,field:'state',value:true,
    confirmedByOperator:true,timeoutMs:1800});
  await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(writes,[[topic,'{"state":"ON"}',{qos:1,retain:false}]]);
  assert.equal(controller.snapshot().inFlight,true);
  // Retained message may reflect an old state; cannot close command.
  preview.observations(true,{quality:'stale',at:Date.now()+20});
  assert.equal(controller.snapshot().inFlight,true);
  preview.observations(true,{quality:'confirmed',at:Date.now()+100});
  const result=await pending;
  assert.equal(result.status,'confirmed');
  assert.equal(result.deviceConfirmed,true);
  assert.equal(result.published,true);
  assert.equal(controller.snapshot().inFlight,false);
  assert.equal(preview.subscribers(),0);
  await assert.rejects(controller.command({deviceId:id,field:'state',value:false,
    confirmedByOperator:true}),/rate_limited/);
});
test('publisher success without actual observed device response times out and never claims success',async()=>{
  const preview=mockPreview();
  const controller=createZigbee2MqttCommandController({
    preview,publish:async()=>{},
  });
  const result=await controller.command({deviceId:id,field:'state',value:true,
    confirmedByOperator:true,timeoutMs:260});
  assert.equal(result.status,'not_confirmed');
  assert.equal(result.deviceConfirmed,false);
  assert.equal(result.published,true);
  assert.equal(preview.subscribers(),0);
});
test('disconnect, device rename and unsupported capability cancel in-flight command',async()=>{
  for(const [change,status] of [
    [preview=>preview.goOffline(),'transport_lost'],
    [preview=>preview.patch({friendlyName:'living/renamed'}),'device_changed'],
    [preview=>preview.patch({supported:false}),'device_lost'],
    [preview=>preview.patch({controls:{}}),'device_changed'],
  ]){
    const preview=mockPreview();
    const controller=createZigbee2MqttCommandController({preview,publish:async()=>{}});
    const p=controller.command({deviceId:id,field:'state',value:true,
      confirmedByOperator:true,timeoutMs:1000});
    await new Promise(resolve=>setTimeout(resolve,5));
    change(preview);
    const result=await p;
    assert.equal(result.status,status);
    assert.equal(result.deviceConfirmed,false);
    assert.equal(preview.subscribers(),0);
  }
});
test('cannot send unsupported states or stale observations; already confirmed does not publish',async()=>{
  const preview=mockPreview({state:true});
  let count=0;
  const driver=createZigbee2MqttCommandController({
    preview,publish:async()=>{count++;},
  });
  const result=await driver.command({deviceId:id,field:'state',value:true,
    confirmedByOperator:true});
  assert.equal(result.status,'already_confirmed');
  assert.equal(result.published,false);
  assert.equal(count,0);
  preview.observations(false,{quality:'stale'});
  await assert.rejects(driver.command({deviceId:id,field:'state',value:true,
    confirmedByOperator:true}),/fresh_state_required/);
  preview.observations(false,{at:Date.now()-61_000});
  await assert.rejects(driver.command({deviceId:id,field:'state',value:true,
    confirmedByOperator:true}),/fresh_state_required/);
  assert.equal(count,0);
});
test('brightness is bounded by per-device capability and step, no arbitrary setpoint',async()=>{
  const preview=mockPreview({
    state:20,field:'brightness',
    controls:{brightness:{kind:'integer',read:true,write:true,min:10,max:200,step:5}},
  });
  const writes=[];
  const driver=createZigbee2MqttCommandController({
    preview,publish:async(...args)=>{writes.push(args);},
  });
  for(const invalid of [9,201,22,-1,300,'80',null,0.5]){
    await assert.rejects(driver.command({deviceId:id,field:'brightness',value:invalid,
      confirmedByOperator:true}),/capability_denied/);
  }
  const pending=driver.command({deviceId:id,field:'brightness',value:80,
    confirmedByOperator:true,timeoutMs:1500});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(writes,[[topic,'{"brightness":80}',{qos:1,retain:false}]]);
  preview.observations(80,{at:Date.now()+100});
  assert.equal((await pending).status,'confirmed');
});
test('publish errors do not trigger retries or false confirmation',async()=>{
  const preview=mockPreview();
  let attempts=0;
  const controller=createZigbee2MqttCommandController({
    preview,publish:async()=>{attempts++;throw Error('broker failure');},
  });
  const response=await controller.command({deviceId:id,field:'state',value:true,
    confirmedByOperator:true,timeoutMs:500});
  assert.equal(response.status,'publish_failed');
  assert.equal(response.deviceConfirmed,false);
  assert.equal(attempts,1);
  assert.equal(controller.snapshot().automaticRetries,false);
  assert.equal(controller.snapshot().deviceControlEnabledInServer,false);
});
