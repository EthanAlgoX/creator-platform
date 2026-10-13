import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {Store} from '../server/storage.js';
import {stamp,uid} from '../server/domain.js';
import {variantMedia,variantLanguage} from '../server/variant-options.js';
import {priorPublications} from '../server/publication-check.js';
import {portableArticle} from '../server/article-export.js';
import type {ConnectorService} from '../server/queue.js';
import type {Job,Media,Variant} from '../server/types.js';

test('language versions preserve separate approvals, ordered images and same-account task snapshots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'creator-language-'));const store=new Store(dir);let publishes=0;
 const service:ConnectorService={getConnectorDefinitions:()=>[{id:'native:x',name:'Test account',description:'Local test only',platformIds:['x'],mode:'publish',fields:[{key:'token',label:'Token',secret:true,required:true}]}],validateConnection:c=>c.config.token?[]:['Missing token'],testConnection:async()=>({ok:true,message:'Verified fixture'}),publish:async()=>{publishes++;return {status:'published',message:'Fixture'};}};
 const instance=createApp({store,connectors:service,startQueue:false});const server=instance.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const api=async(path:string,body?:unknown,method='POST')=>{const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};};
 try{
  const media:Media[]=Array.from({length:5},(_,i)=>({id:uid(),name:`${i}.png`,url:`/uploads/${i}.png`,mime:'image/png',size:8}));for(const m of media)store.put('media',m);
  const content=(await api('/contents',{title:'AI Stock',source:'研究工作流：行情、持仓、报告。',media})).body;
  const cn=(await api(`/contents/${content.id}/generate`,{platformIds:['x'],mode:'rules',language:'zh-CN'})).body.variants[0] as Variant;
  await api(`/variants/${cn.id}`,{mediaIds:[media[1].id,media[0].id]},'PUT');await api(`/variants/${cn.id}`,{approved:true},'PUT');
  const en=(await api('/variants',{contentId:content.id,platformId:'x',language:'en',fromVariantId:cn.id})).body as Variant;
  assert.equal(en.approved,false);assert.deepEqual(en.mediaIds,[media[1].id,media[0].id]);
  assert.equal(store.get<Variant>('variant',cn.id)?.approved,true,'Adding English leaves Chinese approval intact');
  assert.equal((await api('/variants',{contentId:content.id,platformId:'x',language:'en'})).status,409);
  const connection=(await api('/connections',{name:'Test X account',platformId:'x',connector:'native',config:{token:'fixture-secret'}})).body;
  await api(`/variants/${en.id}`,{approved:true},'PUT');
  const identicalTargets=[cn,en].map(v=>({variantId:v.id,connectionId:connection.id}));
  const identicalCheck=await api('/jobs/preflight',{contentId:content.id,targets:identicalTargets});assert.equal(identicalCheck.body.ready,false);assert.ok(identicalCheck.body.checks[1].errors.some((s:string)=>s.includes('重复文案')),'A language label cannot disguise identical posts in one batch');
  assert.equal((await api(`/contents/${content.id}/generate`,{platformIds:['x'],mode:'rules',language:'en'})).status,400,'Rules must not pretend to translate');
  await api(`/variants/${en.id}`,{body:'AI Stock brings market data, holdings and research reports into one workflow.',thread:[],mediaIds:[media[3].id]},'PUT');await api(`/variants/${en.id}`,{approved:true},'PUT');
  assert.equal((await api(`/variants/${en.id}`,{mediaIds:[media[4].id]},'PUT')).body.approved,false,'Changing images revokes approval');
  await api(`/variants/${en.id}`,{approved:true},'PUT');
  const regenerated=await api(`/contents/${content.id}/generate`,{platformIds:['x'],mode:'rules',language:'zh-CN',replaceExisting:true});
  assert.deepEqual(regenerated.body.replacedVariantIds,[cn.id]);assert.equal(store.get<Variant>('variant',en.id)?.approved,true);
  const newCn=regenerated.body.variants[0];assert.deepEqual(newCn.mediaIds,[media[1].id,media[0].id]);await api(`/variants/${newCn.id}`,{approved:true},'PUT');
  const targets=[newCn,en].map(v=>({variantId:v.id,connectionId:connection.id}));
  const preflight=await api('/jobs/preflight',{contentId:content.id,targets});assert.equal(preflight.body.ready,true);assert.deepEqual(preflight.body.checks.map((c:any)=>c.language),['zh-CN','en']);assert.deepEqual(preflight.body.checks[1].media.map((m:Media)=>m.id),[media[4].id]);assert.ok(!JSON.stringify(preflight.body).includes('fixture-secret'));assert.equal(publishes,0);assert.equal(store.list<Job>('job').length,0);
  const scheduledAt=new Date(Date.now()+86400000).toISOString();const jobs=await api('/jobs',{contentId:content.id,targets,scheduledAt});assert.equal(jobs.status,201);assert.equal(jobs.body.jobs.length,2,'Both languages can target one account in a batch');
  assert.deepEqual(jobs.body.jobs.map((j:Job)=>j.media.map(m=>m.id)),[[media[1].id,media[0].id],[media[4].id]]);
  assert.equal((await api('/jobs/preflight',{contentId:content.id,targets})).body.ready,false,'Preflight includes active-task collisions');
  await api(`/variants/${en.id}`,{body:'Changed after scheduling',mediaIds:[]},'PUT');
  assert.equal(store.get<Job>('job',jobs.body.jobs[1].id)?.snapshot.body,'AI Stock brings market data, holdings and research reports into one workflow.');
  for(const job of jobs.body.jobs){await api(`/jobs/${job.id}/cancel`,{});store.put('job',{...job,status:'published',url:'https://example.com/post'});}
  const repeat={contentId:content.id,targets:[targets[0]],scheduledAt};const repeatCheck=await api('/jobs/preflight',repeat);assert.equal(repeatCheck.body.checks[0].previous.length,1);
  assert.equal((await api('/jobs',repeat)).status,409);assert.equal((await api('/jobs',{...repeat,allowDuplicate:true})).status,201);
  await instance.queue.tick();assert.equal(publishes,0,'All fixtures are scheduled; preflight never publishes');
 }finally{await new Promise<void>(r=>server.close(()=>r()));instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('preflight blocks failed credentials and unsupported media before creating tasks',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'creator-preflight-'));const store=new Store(dir);let publishes=0;
 const service:ConnectorService={getConnectorDefinitions:()=>[{id:'native:x',name:'Test',description:'Test',platformIds:['x'],mode:'publish',fields:[]}],validateConnection:()=>[],testConnection:async()=>({ok:false,message:'Expired fixture credentials'}),publish:async()=>{publishes++;return {status:'published',message:'Unexpected'};}};
 const instance=createApp({store,connectors:service,startQueue:false});const server=instance.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const api=async(path:string,body:unknown,method='POST')=>{const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};};
 try{
  const media=Array.from({length:5},(_,i)=>({id:uid(),name:`${i}.png`,url:`/uploads/${i}.png`,mime:'image/png',size:1}));for(const m of media)store.put('media',m);
  const content=(await api('/contents',{title:'Media test',source:'Short text',media})).body;
  const v=(await api(`/contents/${content.id}/generate`,{platformIds:['x'],mode:'rules'})).body.variants[0];await api(`/variants/${v.id}`,{approved:true},'PUT');
  const c=(await api('/connections',{name:'Failed fixture',platformId:'x',connector:'native',config:{}})).body;await api(`/connections/${c.id}/test`,{});
  const payload={contentId:content.id,targets:[{variantId:v.id,connectionId:c.id}]};const result=await api('/jobs/preflight',payload);
  assert.equal(result.body.ready,false);assert.ok(result.body.checks[0].errors.some((s:string)=>s.includes('4')));assert.ok(result.body.checks[0].errors.some((s:string)=>s.includes('检查失败')));
  assert.equal((await api('/jobs',payload)).status,400);assert.equal(store.list<Job>('job').length,0);assert.equal(publishes,0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('selected article media exports in order, while receipts with the same content prevent browser reposts',async()=>{
 const media:Media[]=[0,1,2].map(i=>({id:uid(),name:`${i}.png`,url:`/uploads/${i}.png`,mime:'image/png',size:1}));
 const content={id:uid(),title:'Article',source:'Source',media,createdAt:stamp(),updatedAt:stamp()};
 const variant:Variant={id:uid(),contentId:content.id,platformId:'wechat',title:'Article',body:'Text',tags:[],thread:[],source:'manual',approved:true,issues:[],language:'en',mediaIds:[media[2].id,media[0].id],updatedAt:stamp()};
 const reads:string[]=[];const html=await portableArticle(variant,content,async m=>{reads.push(m.id);return new Uint8Array([1]);});assert.deepEqual(reads,[media[2].id,media[0].id]);assert.equal((html.match(/<img /g)||[]).length,2);assert.match(html,/<html lang="en"/);
 assert.deepEqual(variantMedia({...variant,mediaIds:[]},content),[]);assert.throws(()=>variantMedia({...variant,mediaIds:[uid()]},content),/已移除/);assert.throws(()=>variantMedia({...variant,mediaIds:[media[0].id,media[0].id]},content),/重复/);
 assert.equal(variantLanguage({...variant,language:'英文'}),'en');
 const receipt={id:uid(),connectionId:'browser-receipt-account',platformId:'wechat',snapshot:variant,media:variantMedia(variant,content),origin:'external',status:'published'} as Job;
 assert.equal(priorPublications(variant,receipt.media,'new-connection-id',[receipt]).length,1);
 assert.equal(priorPublications({...variant,language:'zh-CN'},receipt.media,'new-connection-id',[receipt]).length,1,'Changing the language label alone must not bypass duplicate checks');
 assert.equal(priorPublications({...variant,body:'Different'},receipt.media,'new-connection-id',[receipt]).length,0);
});

test('AI language overrides the output prompt without changing the writing profile or existing approval',async()=>{
 let prompt:any;const model=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;prompt=JSON.parse(JSON.parse(body).messages[1].content);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({variants:[{platformId:'x',title:'AI Stock',body:'Research, reports and paper trading in one workspace.',tags:[],thread:[]}]})}}]}));});
 model.listen(0,'127.0.0.1');await new Promise<void>(r=>model.once('listening',r));
 const dir=mkdtempSync(join(tmpdir(),'creator-ai-language-'));const store=new Store(dir);const instance=createApp({store,startQueue:false});const server=instance.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const api=async(path:string,body:unknown,method='POST')=>{const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};};
 try{
  const profile=(await api('/profiles',{name:'中文科技账号',language:'zh-CN',audience:'开发者',forbiddenWords:['保证收益']})).body;
  const content=(await api('/contents',{title:'AI Stock',source:'行情、研究报告与模拟交易工作台。',profileId:profile.id,media:[]})).body;
  const cn=(await api(`/contents/${content.id}/generate`,{platformIds:['x'],mode:'rules'})).body.variants[0];await api(`/variants/${cn.id}`,{approved:true},'PUT');
  await api('/settings',{generation:{enabled:true,baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}`,model:'fixture',apiKey:'fixture-key'}},'PUT');
  const en=await api(`/contents/${content.id}/generate`,{platformIds:['x'],mode:'ai',language:'en'});
  assert.equal(en.status,200);assert.equal(en.body.variants[0].language,'en');assert.equal(en.body.variants[0].approved,false);assert.equal(prompt.outputLanguage,'en');assert.deepEqual(prompt.profile.forbiddenWords,['保证收益']);assert.equal(store.get<any>('profile',profile.id).language,'zh-CN');assert.equal(store.get<Variant>('variant',cn.id)?.approved,true);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await new Promise<void>(r=>model.close(()=>r()));instance.close();rmSync(dir,{recursive:true,force:true});}
});
