// SPDX-License-Identifier: AGPL-3.0-only
import {createServer,request} from 'node:http';

const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export function createUpdateWorkerServer({job,authorize,currentVersion}) {
  let running=false,lastError=null;
  const server=createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    try {
      if(req.method==='GET'&&req.url==='/status') {
        let allowed=false;try{await authorize();allowed=true;}catch{}
        const progress=await job.status();
        reply(200,{...progress,currentVersion:await currentVersion(),
          installAllowed:allowed&&!running&&!progress.recoveryRequired,
          workerAvailable:true,signedFeedConfigured:allowed,manualInstallerImplemented:true,downloadImplemented:true,lastError});return;
      }
      if(req.method!=='POST'||req.url!=='/install'){reply(404,{error:'not_found'});return;}
      if(req.headers['content-type']!=='application/json'){reply(415,{error:'invalid_request'});return;}
      let text='';
      for await(const chunk of req){text+=chunk;if(text.length>1024){reply(413,{error:'invalid_request'});return;}}
      let body;try{body=JSON.parse(text);}catch{reply(400,{error:'invalid_request'});return;}
      if(!body||Object.keys(body).length!==1||typeof body.version!=='string'||
         body.version.length>80||!VERSION.test(body.version)){reply(400,{error:'invalid_version'});return;}
      if(running){reply(409,{error:'update_busy'});return;}
      try{await authorize();}catch{reply(423,{error:'installation_gate_closed'});return;}
      // Recheck after asynchronous authorization, before reserving the worker.
      if(running){reply(409,{error:'update_busy'});return;}
      if((await job.status()).recoveryRequired){reply(409,{error:'update_recovery_required'});return;}
      if(running){reply(409,{error:'update_busy'});return;}
      running=true;lastError=null;
      reply(202,{state:'queued',version:body.version});
      // Worker is a separate systemd service and survives the core restart.
      void job.install(body.version).catch(()=>{lastError='update_failed_check_recovery_status';})
        .finally(()=>{running=false;});
    }catch{if(!res.headersSent)reply(503,{error:'update_worker_unavailable'});else res.end();}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  return server;
}

export function createUpdateWorkerClient(socketPath) {
  if(typeof socketPath!=='string'||!socketPath.startsWith('/run/')||
     !/^\/[a-zA-Z0-9/_-]+\.sock$/.test(socketPath))throw Error('update_socket_invalid');
  function call(path,body) {
    return new Promise((resolve,reject)=>{
      const req=request({socketPath,path,method:body?'POST':'GET',
        headers:body?{'content-type':'application/json'}:{}},res=>{
        let data='';
        res.on('data',chunk=>{data+=chunk;if(data.length>16384)req.destroy(Error('update_response_too_large'));});
        res.on('error',reject);
        res.on('end',()=>{
          try {
            const result=JSON.parse(data);
            if(res.statusCode>=400){const e=Error(result.error??'update_worker_unavailable');e.status=res.statusCode;reject(e);}
            else resolve(result);
          }catch(e){reject(e);}
        });
      });
      req.setTimeout(5000,()=>req.destroy(Error('update_worker_timeout')));
      req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
    });
  }
  return {status:()=>call('/status'),install:version=>call('/install',{version})};
}
