import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/storage.js';
import {createApp} from '../server/app.js';
import type {ConnectorService} from '../server/queue.js';
import type {Job} from '../server/types.js';

test('browser receipts preserve reviewed snapshots, moderation and blockers without sending again',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'creator-receipts-'));const store=new Store(dir);let publishes=0;
 const service:ConnectorService={getConnectorDefinitions:()=>[],validateConnection:()=>[],testConnection:async()=>({ok:true,message:'Mock'}),publish:async()=>{publishes++;return {status:'published',message:'Unexpected network call'};}};
 const instance=createApp({store,connectors:service,startQueue:false});const server=instance.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const api=async(path:string,body?:unknown,method='POST',key?:string)=>{const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};};
 try{
  const content=(await api('/contents',{title:'示例项目',source:'Research workflow',media:[]})).body;
  const variants=(await api(`/contents/${content.id}/generate`,{platformIds:['zhihu','wechat'],mode:'rules'})).body.variants;
  const payload={variantId:variants[0].id,accountName:'测试账号',outcome:'submitted',message:'平台显示审核中'};
  assert.equal((await api('/publication-records',payload)).status,400,'Unreviewed versions cannot be recorded');
  for(const v of variants)await api(`/variants/${v.id}`,{approved:true},'PUT');
  const submitted=await api('/publication-records',payload,'POST','receipt-once');assert.equal(submitted.status,201);
  const job=submitted.body as Job;assert.equal(job.status,'submitted');assert.equal(job.origin,'external');assert.equal(job.attempts,0);
  const replay=await api('/publication-records',payload,'POST','receipt-once');assert.equal(replay.body.id,job.id);
  assert.equal((await api('/publication-records',{...payload,message:'different'},'POST','receipt-once')).status,409);
  assert.equal((await api('/publication-records',payload)).status,409,'Duplicate receipts update the existing job');
  assert.equal((await api(`/jobs/${job.id}/retry`,{})).status,409,'Moderation cannot cause a resend');
  assert.equal((await api(`/jobs/${job.id}/confirm`,{outcome:'published'})).status,400,'Publication needs proof');
  for(const url of ['javascript:alert(1)','https://user:password@example.com/post'])assert.equal((await api(`/jobs/${job.id}/confirm`,{outcome:'published',url})).status,400);
  const result=await api(`/jobs/${job.id}/confirm`,{outcome:'published',url:'https://zhuanlan.zhihu.com/p/123'});assert.equal(result.body.status,'published');
  assert.deepEqual(result.body.resultHistory.map((r:{status:string})=>r.status),['submitted','published']);
  assert.equal((await api(`/jobs/${job.id}/confirm`,{outcome:'failed',message:'平台审核未通过'})).body.status,'failed');
  assert.equal((await api(`/jobs/${job.id}/confirm`,{outcome:'published'})).body.status,'published','Keep verified URL when updating a record');
  const blocked=await api('/publication-records',{variantId:variants[1].id,accountName:'公众号',outcome:'blocked',message:'后台访问受限；在公众号后台完成发送'});assert.equal(blocked.status,201);
  assert.equal((await api(`/jobs/${blocked.body.id}/confirm`,{outcome:'blocked'})).status,400,'Blockers require an actionable reason');
  const form=new FormData();form.set('file',new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}),'proof.png');
  const proof=await (await fetch(base+'/uploads',{method:'POST',body:form})).json() as {id:string};
  const proven=await api(`/jobs/${blocked.body.id}/confirm`,{outcome:'published',proofMediaIds:[proof.id]});assert.equal(proven.body.status,'published');assert.equal(proven.body.proofMedia.length,1);
  assert.equal(proven.body.media.length,0,'Evidence is separate from promotional attachments');
  await api(`/contents/${content.id}`,{title:'Changed',source:'Changed source',media:[]},'PUT');
  assert.equal(store.get<Job>('job',job.id)?.snapshot.body,variants[0].body);
  assert.equal((await api('/publication-records',{...payload,accountName:'Another'})).status,400,'Stale approval rejected');
  await instance.queue.tick();assert.equal(publishes,0);
  assert.equal((await api('/bootstrap',undefined,'GET')).body.connections.length,0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));instance.close();const reopened=new Store(dir);assert.equal(reopened.list<Job>('job').length,2);assert.equal(reopened.list<Job>('job').filter(j=>j.status==='published').length,2);reopened.close();rmSync(dir,{recursive:true,force:true});}
});
