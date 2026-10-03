import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {Store} from '../server/storage.js';
import {platforms} from '../server/catalog.js';
import type {ConnectorService} from '../server/queue.js';
test('expanded catalog generates every target and schedules more than 50 reviewed accounts atomically',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'creator-coverage-'));const store=new Store(dir);let publications=0;
 const connectors:ConnectorService={getConnectorDefinitions:ps=>[{id:'webhook',name:'Mock receiver',description:'No real network',platformIds:ps.map(p=>p.id),fields:[],mode:'custom'}],validateConnection:()=>[],testConnection:async()=>({ok:true,message:'mock'}),publish:async()=>{publications++;return {status:'published',message:'mock'};}};
 const app=createApp({store,connectors,startQueue:false});const server=app.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 async function api(path:string,body:unknown,method='POST'){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};}
 try{
  const content=(await api('/contents',{title:'Full coverage',source:'Original substantive text.',media:[]})).body;
  const generated=await api(`/contents/${content.id}/generate`,{platformIds:platforms.map(p=>p.id),mode:'rules'});
  assert.equal(generated.status,200);assert.equal(generated.body.variants.length,platforms.length);
  const variants=generated.body.variants.filter((v:any)=>!v.issues.some((i:any)=>i.severity==='error'));assert.ok(variants.length>50);
  const targets=[];
  for(const variant of variants){assert.equal((await api(`/variants/${variant.id}`,{approved:true},'PUT')).status,200);const connection=(await api('/connections',{name:variant.platformId,platformId:variant.platformId,connector:'webhook',config:{}})).body;targets.push({variantId:variant.id,connectionId:connection.id});}
  const queued=await api('/jobs',{contentId:content.id,targets,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  assert.equal(queued.status,201);assert.equal(queued.body.jobs.length,targets.length);assert.ok(queued.body.jobs.every((j:any)=>j.status==='scheduled'));assert.equal(new Set(queued.body.jobs.map((j:any)=>j.batchId)).size,1);assert.equal(publications,0);
 }finally{app.queue.stop();await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});}
});
