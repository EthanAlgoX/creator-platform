import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {Store} from '../server/storage.js';
import {createAccessConfig,validateBindHost} from '../server/access.js';
import {publish} from '../server/connectors.js';
import {platformById} from '../server/catalog.js';
import {ruleVariant,uid,stamp} from '../server/domain.js';
import type {Media,Content,ConnectionPrivate,Job} from '../server/types.js';

const proxyToken='test-only-proxy-token-01234567890123456789';
const publicBaseUrl='https://myaistock.top/creator-platform';
const authorized={'X-Creator-Proxy-Token':proxyToken};

async function fixture(remoteMode=true){
 const dir=mkdtempSync(join(tmpdir(),'creator-remote-access-'));const store=new Store(join(dir,'data'));
 const dist=join(dir,'dist');mkdirSync(join(dist,'assets'),{recursive:true});
 writeFileSync(join(dist,'index.html'),'<!doctype html><title>Protected studio</title>');
 writeFileSync(join(dist,'assets','app.js'),'window.studioLoaded=true;');
 writeFileSync(join(store.uploadDir,'sample.png'),Buffer.from([137,80,78,71,13,10,26,10]));
 const instance=createApp({store,startQueue:false,remoteMode,proxyToken,publicBaseUrl,staticDir:dist});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const port=(server.address() as {port:number}).port;
 const request=(path:string,headers:Record<string,string>={},method='GET',body?:unknown)=>new Promise<{status:number;body:string;headers:Record<string,unknown>}>((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port,path,method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,body:text,headers:res.headers}));});
  req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
 });
 return {request,store,queue:instance.queue,async close(){instance.queue.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('remote configuration and non-loopback binding require explicit valid opt-in',()=>{
 for(const config of [
  {remoteMode:true,publicBaseUrl},
  {remoteMode:true,publicBaseUrl,proxyToken:'short'},
  {remoteMode:true,proxyToken},
  {remoteMode:true,publicBaseUrl:'not-a-url',proxyToken},
  {remoteMode:true,publicBaseUrl:'ftp://myaistock.top/creator-platform',proxyToken},
  {remoteMode:true,publicBaseUrl:'https://user:password@myaistock.top/creator-platform',proxyToken},
  {remoteMode:true,publicBaseUrl:publicBaseUrl+'?secret=wrong',proxyToken},
  {remoteMode:true,publicBaseUrl:publicBaseUrl+'#fragment',proxyToken},
 ])assert.throws(()=>createAccessConfig(config));
 const local=createAccessConfig({remoteMode:false,publicBaseUrl});assert.equal(local.remoteMode,false);assert.throws(()=>validateBindHost('0.0.0.0',local));
 const remote=createAccessConfig({remoteMode:true,publicBaseUrl,proxyToken});assert.equal(remote.publicOrigin,'https://myaistock.top');
 for(const host of ['127.0.0.1','localhost','::1','0.0.0.0'])assert.doesNotThrow(()=>validateBindHost(host,remote));
 for(const host of ['::','192.0.2.1','myaistock.top'])assert.throws(()=>validateBindHost(host,remote));
 assert.throws(()=>createApp({remoteMode:true,publicBaseUrl,proxyToken:''}),/CREATOR_PROXY_TOKEN/);
});

test('remote UI, API, uploads and mutations all fail closed without the trusted proxy token',async()=>{
 const f=await fixture();try{
  for(const path of ['/','/assets/app.js','/api/health','/api/bootstrap','/uploads/sample.png','/api/missing']){
   const missingOrInvalidHeaders:Record<string,string>[]=[{},{'X-Creator-Proxy-Token':'wrong'},{'X-Creator-Proxy-Token':'x'.repeat(proxyToken.length)}];
   for(const headers of missingOrInvalidHeaders){
    const result=await f.request(path,headers);assert.equal(result.status,403,path);assert.ok(!result.body.includes(proxyToken));
   }
  }
  const denied=await f.request('/api/contents',{},'POST',{title:'must not persist',source:'test'});assert.equal(denied.status,403);assert.equal(f.store.list('content').length,0);
 }finally{await f.close();}
});

test('remote access accepts exact public origin and only configured/loopback Host values',async()=>{
 const f=await fixture();try{
  for(const Host of ['myaistock.top','myaistock.top:443','localhost:4318','127.0.0.1:4318','[::1]:4318']){
   const response=await f.request('/api/health',{...authorized,Host,Origin:'https://myaistock.top'});assert.equal(response.status,200,Host);
  }
  for(const Origin of ['http://myaistock.top','https://myaistock.top:444','https://evil.myaistock.top','https://myaistock.top.attacker.example','https://myaistock.top/','https://myaistock.top/path','http://localhost:4317','null'])assert.equal((await f.request('/api/health',{...authorized,Origin})).status,403,Origin);
  for(const Host of ['evil.myaistock.top','myaistock.top.attacker.example','[2001:db8::1]:4318','user@myaistock.top','myaistock.top/path'])assert.equal((await f.request('/api/health',{...authorized,Host})).status,403,Host);
  assert.equal((await f.request('/api/health',authorized)).status,200,'server health checks have no Origin but still require a proxy token');
  assert.equal(JSON.parse((await f.request('/api/bootstrap',authorized)).body).remoteMode,true);
  const created=await f.request('/api/contents',{...authorized,Origin:'https://myaistock.top'},'POST',{title:'Reviewed deployment test',source:'No publication occurs.'});assert.equal(created.status,201);
 }finally{await f.close();}
});

test('authenticated production static assets and SPA routes work while unknown API/uploads stay 404',async()=>{
 const f=await fixture();try{
  for(const path of ['/','/studio']){const result=await f.request(path,authorized);assert.equal(result.status,200);assert.match(result.body,/Protected studio/);}
  const asset=await f.request('/assets/app.js',authorized);assert.equal(asset.status,200);assert.match(asset.body,/studioLoaded/);
  const uploaded=await f.request('/uploads/sample.png',authorized);assert.equal(uploaded.status,200);assert.match(String(uploaded.headers['content-security-policy']),/sandbox/);
  for(const path of ['/api/missing','/uploads/missing.png']){const result=await f.request(path,authorized);assert.equal(result.status,404);assert.equal(JSON.parse(result.body).error,'接口不存在');assert.doesNotMatch(result.body,/Protected studio/);}
 }finally{await f.close();}
});

test('a public media base does not enable remote access or change default local protection',async()=>{
 const f=await fixture(false);try{
  assert.equal((await f.request('/api/health')).status,200);
  assert.equal(JSON.parse((await f.request('/api/bootstrap')).body).remoteMode,false);
  assert.equal((await f.request('/api/health',{Origin:'http://localhost:4317'})).status,200);
  assert.equal((await f.request('/api/health',{Host:'myaistock.top',...authorized})).status,403);
  assert.equal((await f.request('/api/health',{Origin:'https://myaistock.top',...authorized})).status,403);
 }finally{await f.close();}
});

test('URL-based connectors reject protected uploads before sending any remote request',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('No remote request should be made');};
 const media:Media={id:uid(),name:'test.png',url:'/uploads/test.png',mime:'image/png',size:8};
 const content:Content={id:uid(),title:'Test article',source:'Original content',media:[media],createdAt:stamp(),updatedAt:stamp()};
 const targets:[string,string,Record<string,string>][]=[
  ['native','devto',{apiKey:'mock-only',postType:'draft'}],
  ['native','lemmy',{baseUrl:'https://lemmy.example',accessToken:'mock-only',communityId:'1'}],
  ['native','blogger',{accessToken:'mock-only',blogId:'123'}],
  ['xiaohongshu','xiaohongshu',{baseUrl:'http://127.0.0.1:18060'}],
  ['wechatsync','zhihu',{baseUrl:'http://127.0.0.1:9528'}],
  ['webhook','reddit',{url:'https://receiver.example/publish'}],
 ];
 try{
  for(const [connector,platformId,config] of targets){
   const platform=platformById(platformId);
   await assert.rejects(()=>publish({id:uid(),name:'Mock only',platformId,connector,enabled:true,config},platform,ruleVariant(content,platform),[media],{publicBaseUrl,protectedMedia:true,readMedia:async()=>new Uint8Array()}),error=>{
    assert.match((error as Error).message,/当前素材需要登录/);assert.equal((error as {uncertain?:boolean}).uncertain,false);return true;
   });
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('remote app queue marks incompatible protected media failed before any remote call',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No remote request should be made');};
 const f=await fixture();try{
  const now=stamp();const connection:ConnectionPrivate={id:uid(),name:'Mock DEV',platformId:'devto',connector:'native',enabled:true,config:{apiKey:'mock-only',postType:'draft'}};
  const {config,...saved}=connection;f.store.put('connection',{...saved,createdAt:now});f.store.setSecret(`connection:${connection.id}`,config);
  const media:Media={id:uid(),name:'test.png',url:'/uploads/sample.png',mime:'image/png',size:8};
  const content:Content={id:uid(),title:'Test article',source:'Original content',media:[media],createdAt:now,updatedAt:now};const snapshot={...ruleVariant(content,platformById('devto')),approved:true};
  const job:Job={id:uid(),batchId:uid(),contentId:content.id,variantId:snapshot.id,connectionId:connection.id,platformId:'devto',connectionName:connection.name,title:snapshot.title,status:'queued',scheduledAt:now,attempts:0,message:'Mock only',createdAt:now,updatedAt:now,snapshot,media:[media]};
  f.store.put('job',job);await f.queue.tick();
  const result=f.store.get<Job>('job',job.id)!;assert.equal(result.status,'failed');assert.match(result.message,/当前素材需要登录/);assert.equal(calls,0);
 }finally{await f.close();globalThis.fetch=original;}
});

test('direct file uploads to WordPress and Postiz still work with protected local media',async()=>{
 const original=globalThis.fetch;let calls=0;let reads=0;
 const media:Media={id:uid(),name:'test.png',url:'/uploads/test.png',mime:'image/png',size:8};
 const content:Content={id:uid(),title:'Test article',source:'Original content',media:[media],createdAt:stamp(),updatedAt:stamp()};
 const context={publicBaseUrl,protectedMedia:true,readMedia:async()=>{reads++;return new Uint8Array([137,80,78,71,13,10,26,10]);}};
 globalThis.fetch=async(input,init)=>{
  calls++;const url=String(input);let response:unknown;
  if(url==='https://wordpress.example/wp-json/wp/v2/media'){assert.ok(init?.body instanceof Blob);response={id:3,source_url:'https://wordpress.example/wp-content/test.png'};}
  else if(url==='https://wordpress.example/wp-json/wp/v2/posts'){assert.match(String(init?.body),/wordpress.example\/wp-content\/test.png/);response={id:4,status:'draft',link:'https://wordpress.example/?p=4'};}
  else if(url==='https://postiz.example/public/v1/upload'){assert.ok(init?.body instanceof FormData);response={id:'file-1',path:'https://postiz.example/media/test.png'};}
  else if(url==='https://postiz.example/public/v1/posts'){assert.match(String(init?.body),/postiz.example\/media\/test.png/);response=[{integration:'integration-1',postId:'draft-1'}];}
  else assert.fail(`Unexpected mock request: ${url}`);
  assert.ok(!String(init?.body).includes('myaistock.top/creator-platform/uploads'));
  return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  for(const [connector,platformId,config] of [
   ['native','wordpress',{baseUrl:'https://wordpress.example',username:'mock-user',applicationPassword:'mock-only',postType:'draft'}],
   ['postiz','x',{baseUrl:'https://postiz.example/public/v1',apiKey:'mock-only',integrationId:'integration-1',postType:'draft'}],
  ] as [string,string,Record<string,string>][]){
   const platform=platformById(platformId);const result=await publish({id:uid(),name:'Mock only',platformId,connector,enabled:true,config},platform,ruleVariant(content,platform),[media],context);assert.equal(result.status,'drafted');
  }
  assert.equal(calls,4);assert.equal(reads,2);assert.equal(media.url,'/uploads/test.png');
 }finally{globalThis.fetch=original;}
});

test('connector media URL retains the deployment subpath without changing stored upload paths',async()=>{
 const original=globalThis.fetch;let calls=0;
 const media:Media={id:uid(),name:'test.png',url:'/uploads/test.png',mime:'image/png',size:8};
 const content:Content={id:uid(),title:'Test article',source:'Original content',media:[media],createdAt:stamp(),updatedAt:stamp()};
 globalThis.fetch=async(input,init)=>{
  calls++;assert.equal(String(input),'https://dev.to/api/articles');
  const payload=JSON.parse(String(init?.body));assert.equal(payload.article.main_image,'https://myaistock.top/creator-platform/uploads/test.png');
  return new Response(JSON.stringify({id:123,published:false,url:'https://dev.to/test/article'}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const result=await publish({id:uid(),name:'Mock Dev.to',platformId:'devto',connector:'native',enabled:true,config:{apiKey:'mock-only',postType:'draft'}},platformById('devto'),ruleVariant(content,platformById('devto')),[media],{publicBaseUrl,readMedia:async()=>new Uint8Array()});
  assert.equal(result.status,'drafted');assert.equal(calls,1);assert.equal(media.url,'/uploads/test.png');
 }finally{globalThis.fetch=original;}
});
