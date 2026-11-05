// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Aedes } from 'aedes';
import { connect } from 'mqtt';
import { createZigbee2MqttMqttPreview } from '../src/integrations/zigbee2mqtt-mqtt.mjs';
import { createZigbee2MqttCommandController } from '../src/integrations/zigbee2mqtt-command-controller.mjs';

const IEEE='0x00158d00018255df';
const descriptor={type:'switch',features:[{
  type:'binary',name:'state',property:'state',access:7,value_on:'ON',value_off:'OFF',
}]};
const catalog=[{
  ieee_address:IEEE,friendly_name:'living/plug',
  supported:true,type:'Router',definition:{model:'SIM-PLUG',vendor:'CI',exposes:[descriptor]},
}];
async function waitFor(predicate,timeout=4000){
  const start=Date.now();
  while(!predicate()){
    if(Date.now()-start>timeout)throw Error('test_observation_timeout');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}
test('real MQTT QoS1 command is confirmed only after later independent Zigbee2MQTT state',async t=>{
  const broker=await Aedes.createBroker();
  const tcp=createServer(broker.handle);
  tcp.listen(0,'127.0.0.1');
  await once(tcp,'listening');
  const url='mqtt://127.0.0.1:'+tcp.address().port;
  const producer=connect(url,{clientId:'simulated-z2m-device',reconnectPeriod:0});
  const command=connect(url,{clientId:'isolated-dira-command-test',reconnectPeriod:0});
  const publish=(client,topic,value,retain=false)=>new Promise((resolve,reject)=>{
    client.publish('zigbee2mqtt/'+topic,JSON.stringify(value),
      {qos:1,retain},e=>e?reject(e):resolve());
  });
  const preview=createZigbee2MqttMqttPreview({
    config:{url,baseTopic:'zigbee2mqtt',readOnly:true},
  });
  const controller=createZigbee2MqttCommandController({
    preview,publish:(topic,payload,options)=>new Promise((resolve,reject)=>
      command.publish(topic,payload,options,e=>e?reject(e):resolve())),
  });
  t.after(async()=>{
    controller.dispose();
    await preview.stop();
    await Promise.all([producer,command].map(client=>
      new Promise(resolve=>client.end(true,{},resolve))));
    await new Promise(resolve=>tcp.close(resolve));
    await new Promise(resolve=>broker.close(resolve));
  });
  await Promise.all([once(producer,'connect'),once(command,'connect')]);
  await preview.start();
  let setCount=0,subscribedObserved=0;
  broker.on('publish',(packet,client)=>{
    if(client?.id?.startsWith('domyro-readonly-'))subscribedObserved++;
    if(packet.topic==='zigbee2mqtt/living/plug/set' && client?.id==='isolated-dira-command-test'){
      setCount++;
      assert.equal(packet.retain,false);
      assert.equal(packet.qos,1);
      assert.equal(packet.payload.toString(),'{"state":"ON"}');
      // Broker accepted packet. Device state confirmation is deliberately
      // published *later* as an independent message from a different client.
      setTimeout(()=>publish(producer,'living/plug',{state:'ON'}).catch(()=>{}),80);
    }
  });
  await publish(producer,'bridge/state',{state:'online'},true);
  await publish(producer,'bridge/devices',catalog,true);
  await publish(producer,'living/plug',{state:'OFF'});
  await waitFor(()=>preview.snapshot().devices[0]?.observations?.state?.value===false);
  assert.equal(preview.snapshot().devices[0].controls.state.write,true);
  const promise=controller.command({deviceId:IEEE,field:'state',value:true,
    confirmedByOperator:true,timeoutMs:1600});
  await waitFor(()=>setCount===1);
  assert.equal(controller.snapshot().inFlight,true,'QoS ACK is not device confirmation');
  const result=await promise;
  assert.equal(result.status,'confirmed');
  assert.equal(result.deviceConfirmed,true);
  assert.equal(result.published,true);
  assert.equal(setCount,1);
  assert.equal(subscribedObserved,0,'original read-only preview must never publish');
  assert.equal(preview.snapshot().devices[0].observations.state.value,true);
  assert.equal(preview.snapshot().devices[0].observations.state.quality,'confirmed');
});
test('negative real-broker test: no device response means no asserted physical change',async t=>{
  const broker=await Aedes.createBroker();
  const tcp=createServer(broker.handle);
  tcp.listen(0,'127.0.0.1');
  await once(tcp,'listening');
  const url='mqtt://127.0.0.1:'+tcp.address().port;
  const producer=connect(url,{clientId:'simulator-no-device-ack',reconnectPeriod:0});
  const command=connect(url,{clientId:'command-without-device-ack',reconnectPeriod:0});
  const preview=createZigbee2MqttMqttPreview({config:{url,baseTopic:'zigbee2mqtt',readOnly:true}});
  const controller=createZigbee2MqttCommandController({preview,
    publish:(topic,payload,options)=>new Promise((resolve,reject)=>
      command.publish(topic,payload,options,e=>e?reject(e):resolve())),
  });
  t.after(async()=>{
    controller.dispose();await preview.stop();
    await Promise.all([producer,command].map(client=>
      new Promise(resolve=>client.end(true,{},resolve))));
    await new Promise(resolve=>tcp.close(resolve));
    await new Promise(resolve=>broker.close(resolve));
  });
  await Promise.all([once(producer,'connect'),once(command,'connect')]);
  await preview.start();
  const send=(topic,value)=>new Promise((resolve,reject)=>
    producer.publish('zigbee2mqtt/'+topic,JSON.stringify(value),{qos:1},
      error=>error?reject(error):resolve()));
  await send('bridge/state',{state:'online'});
  await send('bridge/devices',catalog);
  await send('living/plug',{state:'OFF'});
  await waitFor(()=>preview.snapshot().devices[0]?.observations?.state?.value===false);
  const pending=controller.command({deviceId:IEEE,field:'state',value:true,
    confirmedByOperator:true,timeoutMs:450});
  const result=await pending;
  assert.equal(result.status,'not_confirmed');
  assert.equal(result.deviceConfirmed,false);
  assert.equal(preview.snapshot().devices[0].observations.state.value,false);
});
