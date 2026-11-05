// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafeZigbeeControls } from '../src/integrations/zigbee2mqtt-capabilities.mjs';
import { createZigbee2MqttObserver } from '../src/integrations/zigbee2mqtt-observer.mjs';

const state={type:'binary',name:'state',property:'state',access:7,value_on:'ON',value_off:'OFF'};
const brightness={type:'numeric',name:'brightness',property:'brightness',access:7,value_min:0,value_max:254};
const light=features=>({type:'light',features});
const sw=features=>({type:'switch',features});
const ieee='0x00158d00018255df',base='zigbee2mqtt';
const accept=(o,topic,body,retained=false)=>o.accept(base+'/'+topic,Buffer.from(JSON.stringify(body)),{retained});
test('only real read+write capability bits authorize single-endpoint binary light/switch actions',()=>{
  assert.deepEqual(parseSafeZigbeeControls([sw([state])]).state,
    {kind:'boolean',read:true,write:true});
  const caps=parseSafeZigbeeControls([light([state,brightness])]);
  assert.deepEqual(caps.brightness,{kind:'integer',read:true,write:true,min:0,max:254,step:1});
  assert.equal(Object.isFrozen(caps),true);
  assert.equal(Object.isFrozen(caps.state),true);
  assert.equal(parseSafeZigbeeControls([sw([state])]).brightness,undefined);
  for(const invalid of [
    {...state,access:1},{...state,access:2},{...state,access:4},
    {...state,value_on:'TOGGLE'},{...state,property:'state_l1'},
    {...state,endpoint:'l1'},{...state,category:'config'},
    {...state,access:15},{...state,type:'enum'},
  ])assert.equal(parseSafeZigbeeControls([sw([invalid])]).state,undefined);
  assert.deepEqual(parseSafeZigbeeControls([sw([state,state])]),{});
  assert.deepEqual(parseSafeZigbeeControls([light([brightness,brightness])]).brightness,undefined);
});
test('never expose lock, cover, climate, composite, unsupported generic or non-integer setpoints as commands',()=>{
  const b=brightness;
  for(const ex of [
    [{type:'lock',features:[state]}],
    [{type:'cover',features:[state]}],
    [{type:'climate',features:[state]}],
    [{type:'composite',features:[state]}],
    [{type:'binary',...state}],
    [{type:'light',endpoint:'l1',features:[state]}],
  ])assert.deepEqual(parseSafeZigbeeControls(ex),{});
  for(const invalid of [
    {...b,value_min:-1},{...b,value_max:255},
    {...b,value_min:0.5},{...b,value_max:90.5},
    {...b,value_step:0},{...b,value_step:1.5},
    {...b,access:1},{...b,category:'diagnostic'},
  ])assert.equal(parseSafeZigbeeControls([light([invalid])]).brightness,undefined);
  assert.deepEqual(parseSafeZigbeeControls(null),{});
  assert.deepEqual(parseSafeZigbeeControls(Array(65).fill(light([state]))),{});
});
test('Zigbee2MQTT observer publishes real capability metadata without granting unsupported devices write access',()=>{
  const o=createZigbee2MqttObserver();
  o.brokerConnected();
  assert.equal(accept(o,'bridge/state',{state:'online'}),true);
  assert.equal(accept(o,'bridge/devices',[{
    ieee_address:ieee,friendly_name:'living/plug',type:'Router',supported:true,
    definition:{model:'TEST',exposes:[sw([state])]},
  },{
    ieee_address:'0x00158d0001825500',friendly_name:'hall/sensor',supported:true,
    definition:{exposes:[{type:'numeric',name:'temperature',property:'temperature',access:1}]},
  },{
    ieee_address:'0x00158d0001825501',friendly_name:'bedroom/plug',supported:false,
    definition:{exposes:[sw([state])]},
  }]),true);
  const snapshot=o.snapshot();
  assert.equal(snapshot.devices.length,3);
  assert.equal(snapshot.devices[0].controls.state,undefined);
  assert.equal(snapshot.devices[1].controls.state,undefined);
  assert.equal(snapshot.devices[2].controls.state.write,true);
  // No control method is exposed by the read-only observer.
  assert.equal(typeof o.publish,'undefined');
  assert.equal(typeof o.command,'undefined');
});
