import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Store} from './storage.js';
import type {ConnectionPrivate,Job,Media,Platform,Variant,PublishContext,PublishResult,ConnectorDefinition} from './types.js';
import {stamp} from './domain.js';
export type ConnectorService = {
 getConnectorDefinitions:(platforms:Platform[])=>ConnectorDefinition[];
 validateConnection:(connection:ConnectionPrivate,platform:Platform)=>string[];
 testConnection:(connection:ConnectionPrivate,platform:Platform)=>Promise<{ok:boolean;message:string}>;
 publish:(connection:ConnectionPrivate,platform:Platform,variant:Variant,media:Media[],context:PublishContext)=>Promise<PublishResult>;
 checkPublication?:(connection:ConnectionPrivate,platform:Platform,remoteId:string)=>Promise<PublishResult|null>;
};
export function readMedia(store:Store,media:Media):Promise<Uint8Array> {
 return readFile(localMediaPath(store,media));
}
export function localMediaPath(store:Store,media:Media):string {
 const match=media.url.match(/^\/uploads\/([a-f0-9-]+\.(?:png|jpg|webp|gif|mp4|pdf))$/);if(!match)throw new Error('素材必须为工作台上传的本机文件');
 return join(store.uploadDir,match[1]);
}
export function redactMessage(message:string,config:Record<string,string>={}):string {
 let safe=message;for(const [key,value] of Object.entries(config))if(value&&value.length>=4&&/(token|key|secret|password|webhook|authorization)/i.test(key))safe=safe.split(value).join('[已隐藏]');
 return safe.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [已隐藏]').slice(0,1200);
}
export class JobQueue {
 private timer:ReturnType<typeof setInterval>|undefined;
 private active=new Set<string>();
 private reconciling=new Set<string>();
 private lastChecks=new Map<string,number>();
 constructor(private store:Store,private platforms:Platform[],private service:ConnectorService,private connection:(id:string)=>ConnectionPrivate|undefined,private publicBaseUrl:string){}
 recover(){for(const job of this.store.list<Job>('job'))if(job.status==='running')this.store.put('job',{...job,status:'unconfirmed',message:'程序在发布过程中退出，远端结果未知；请核对平台记录后再确认或重试。',updatedAt:stamp()});}
 start(){this.recover();this.timer=setInterval(()=>void this.tick(),1500);this.timer.unref();void this.tick();}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
 async tick(){
  const jobs=this.store.list<Job>('job').sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt));
  const eligible=jobs.filter(j=>(j.status==='queued'||j.status==='scheduled')&&new Date(j.scheduledAt).getTime()<=Date.now()&&!this.active.has(j.id));
  const tasks:Promise<void>[]=[];for(const job of eligible.slice(0,Math.max(0,2-this.active.size))){this.active.add(job.id);tasks.push(this.run(job).finally(()=>this.active.delete(job.id)));}
  if(this.service.checkPublication)for(const job of jobs){const connection=this.connection(job.connectionId);if(job.status==='unconfirmed'&&job.remoteId&&connection?.connector==='postiz'&&!this.reconciling.has(job.id)&&Date.now()-(this.lastChecks.get(job.id)||0)>15000){this.lastChecks.set(job.id,Date.now());this.reconciling.add(job.id);tasks.push(this.reconcile(job,connection).finally(()=>this.reconciling.delete(job.id)));}}
  await Promise.allSettled(tasks);
 }
 private async run(job:Job){
  const current=this.store.get<Job>('job',job.id);if(!current||!['queued','scheduled'].includes(current.status))return;
  const connection=this.connection(job.connectionId);const platform=this.platforms.find(p=>p.id===job.platformId);
  if(!connection||!connection.enabled||!platform){this.store.put('job',{...job,status:'failed',message:'渠道已删除、停用或平台不存在。',updatedAt:stamp()});return;}
  const running:Job={...job,status:'running',attempts:job.attempts+1,message:'正在执行发布请求',updatedAt:stamp()};this.store.put('job',running);
  try{
   const result=await this.service.publish(connection,platform,job.snapshot,job.media,{publicBaseUrl:this.publicBaseUrl,readMedia:m=>readMedia(this.store,m),localMediaPath:m=>localMediaPath(this.store,m)});
   this.store.put('job',{...running,...result,message:redactMessage(result.message,connection.config),updatedAt:stamp()});
  }catch(error){const uncertain=!!(error as {uncertain?:boolean})?.uncertain;const message=error instanceof Error?error.message:'发布失败';this.store.put('job',{...running,status:uncertain?'unconfirmed':'failed',message:redactMessage(message,connection.config),updatedAt:stamp()});}
 }
 private async reconcile(job:Job,connection:ConnectionPrivate){
  const platform=this.platforms.find(p=>p.id===job.platformId);if(!platform)return;
  try{const result=await this.service.checkPublication!(connection,platform,job.remoteId!);const current=this.store.get<Job>('job',job.id);if(result&&current?.status==='unconfirmed')this.store.put('job',{...current,...result,message:redactMessage(result.message,connection.config),updatedAt:stamp()});}catch(error){
   // A definite remote task failure changes status; a transient read failure never reposts.
   const current=this.store.get<Job>('job',job.id);
   if((error as {terminalFailure?:boolean})?.terminalFailure&&current?.status==='unconfirmed')this.store.put('job',{...current,status:'failed',message:redactMessage(error instanceof Error?error.message:'远端任务已失败',connection.config),updatedAt:stamp()});
  }
 }
}
