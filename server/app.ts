import express,{type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Store} from './storage.js';
import {platforms,platformById} from './catalog.js';
import {stamp,uid,revision,ruleVariant,toHtml,validateVariant,isApprovedValid,safeMedia} from './domain.js';
import {variantLanguage,variantMedia,normalizeLanguage,variantSlot} from './variant-options.js';
import {generateAI,type GenerationConfig} from './generation.js';
import {connectorMediaIssues,priorPublications,publicationFingerprint,type PublicationCheck} from './publication-check.js';
import {portableArticle} from './article-export.js';
import {registerPublicationRecords,resultSchema,resultProof,checkExternalResult,outcomeLabels} from './publication-records.js';
import {JobQueue,readMedia,redactMessage,type ConnectorService} from './queue.js';
import * as defaultConnectors from './connectors.js';
import {createAccessConfig,accessMiddleware} from './access.js';
import type {Content,Connection,ConnectionPrivate,Profile,Variant,Job,Media,Settings,Bootstrap} from './types.js';

class ApiError extends Error {constructor(message:string,readonly status=400){super(message);}}
const string=z.string().max(100000);const id=z.string().uuid();
const contentSchema=z.object({title:z.string().trim().min(1,'请填写标题').max(500),source:string.trim().min(1,'请填写内容'),profileId:z.string().optional(),media:z.array(z.object({id:string,name:string,url:string,mime:string,size:z.number()})).max(20).optional()});
const profileSchema=z.object({name:z.string().trim().min(1).max(100),audience:z.string().max(1000).default(''),tone:z.string().max(1000).default('自然、具体、清楚'),language:z.string().max(50).default('中文'),description:z.string().max(10000).default(''),forbiddenWords:z.array(z.string().max(100)).max(100).default([])});
const connectionSchema=z.object({name:z.string().trim().min(1).max(100),platformId:z.string().min(1),connector:z.string().min(1),enabled:z.boolean().optional(),config:z.record(z.string(),z.string().max(100000)).default({})});
const variantSchema=z.object({title:z.string().max(2000).optional(),body:string.optional(),tags:z.array(z.string().max(100)).max(30).optional(),thread:z.array(z.string().max(10000)).max(200).optional(),approved:z.boolean().optional(),rebase:z.boolean().optional(),language:z.enum(['zh-CN','en','zh-TW']).optional(),mediaIds:z.array(id).max(20).optional()});
const activeStates=['queued','scheduled','running','needs_action','unconfirmed','submitted','blocked'];
type StoredConnection={id:string;name:string;platformId:string;connector:string;enabled:boolean;createdAt:string;lastTest?:Connection['lastTest']};
function sameConfig(left:Record<string,string>,right:Record<string,string>):boolean {return Object.keys(left).length===Object.keys(right).length&&Object.entries(left).every(([key,value])=>right[key]===value);}
function testScope(connection:ConnectionPrivate):'configuration'|'credentials' {
 return connection.connector==='multipost'||connection.connector==='webhook'&&!connection.config.healthUrl||connection.connector==='native'&&['slack','feishu','dingtalk','wecom','teams'].includes(connection.platformId)?'configuration':'credentials';
}
export function createApp(options:{store?:Store;connectors?:ConnectorService;publicBaseUrl?:string;startQueue?:boolean;remoteMode?:boolean;proxyToken?:string;staticDir?:string}={}){
 const suppliedBaseUrl=options.publicBaseUrl??process.env.PUBLIC_BASE_URL;
 const access=createAccessConfig({remoteMode:options.remoteMode??process.env.CREATOR_REMOTE_MODE==='1',publicBaseUrl:suppliedBaseUrl,proxyToken:options.proxyToken??process.env.CREATOR_PROXY_TOKEN});
 const store=options.store||new Store();const service=options.connectors||defaultConnectors;
 const app=express();app.disable('x-powered-by');
 const publicBaseUrl=suppliedBaseUrl||`http://127.0.0.1:${process.env.PORT||4318}`;
 app.use(accessMiddleware(access));
 app.use('/api',express.json({limit:'2mb'}));
 app.use('/uploads',express.static(store.uploadDir,{dotfiles:'deny',index:false,setHeaders:res=>{res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");}}));
 const get=<T>(kind:string,value:string):T=>{const saved=store.get<T>(kind,value);if(!saved)throw new ApiError('记录不存在',404);return saved;};
 const rawConnection=(value:string):ConnectionPrivate|undefined=>{const saved=store.get<StoredConnection>('connection',value);return saved?{...saved,config:store.getSecret<Record<string,string>>(`connection:${value}`)||{}}:undefined;};
 const definitionFor=(connector:string,platformId:string)=>service.getConnectorDefinitions(platforms).find(d=>d.id===(connector==='native'?`native:${platformId}`:connector)&&d.platformIds.includes(platformId));
 const publicConnection=(saved:StoredConnection):Connection=>{const raw=rawConnection(saved.id)!;const definition=definitionFor(saved.connector,saved.platformId);const secretFields=new Set(definition?.fields.filter(f=>f.secret).map(f=>f.key)||[]);const secretKeys=Object.keys(raw.config).filter(key=>secretFields.has(key)||/(token|key|secret|password|webhook|authorization)/i.test(key));return {...saved,config:Object.fromEntries(Object.entries(raw.config).filter(([key])=>!secretKeys.includes(key))),secretKeys:secretKeys.filter(key=>!!raw.config[key]),configured:!service.validateConnection(raw,platformById(saved.platformId)).length};};
 const generationPrivate=():GenerationConfig=>store.getSecret<GenerationConfig>('generation')||{enabled:false,baseUrl:'',model:'',apiKey:''};
 const settings=():Settings=>{const {apiKey,...generation}=generationPrivate();return {generation:{...generation,hasApiKey:!!apiKey},timezone:store.get<{id:string;timezone:string}>('setting','local')?.timezone||'Asia/Shanghai'};};
 const currentProfile=(content:Content)=>content.profileId?store.get<Profile>('profile',content.profileId):undefined;
 const queue=new JobQueue(store,platforms,service,rawConnection,publicBaseUrl,access.remoteMode);
 if(options.startQueue!==false)queue.start();
 app.get('/api/health',(_req,res)=>res.json({ok:true}));
 app.get('/api/bootstrap',(_req,res)=>{const bootstrap:Bootstrap={platforms,profiles:store.list<Profile>('profile'),contents:store.list<Content>('content'),variants:store.list<Variant>('variant'),connections:store.list<StoredConnection>('connection').map(publicConnection),jobs:store.list<Job>('job'),settings:settings(),connectorDefinitions:service.getConnectorDefinitions(platforms),remoteMode:access.remoteMode};res.json(bootstrap);});
 app.post('/api/contents',(req,res)=>{const data=contentSchema.parse(req.body);if(data.profileId&&!store.get('profile',data.profileId))throw new ApiError('创作画像不存在');const now=stamp();const content:Content={...data,id:uid(),media:safeMedia(data.media||[],store.list<Media>('media')),profileId:data.profileId||undefined,createdAt:now,updatedAt:now};store.put('content',content);res.status(201).json(content);});
 app.put('/api/contents/:id',(req,res)=>{const old=get<Content>('content',String(req.params.id));const data=contentSchema.parse(req.body);if(data.profileId&&!store.get('profile',data.profileId))throw new ApiError('创作画像不存在');const content:Content={...old,...data,profileId:data.profileId||undefined,media:safeMedia(data.media||[],store.list<Media>('media')),updatedAt:stamp()};store.transaction(()=>{store.put('content',content);if(revision(content)!==revision(old))for(const variant of store.list<Variant>('variant').filter(v=>v.contentId===old.id)){variant.approved=false;variant.issues=validateVariant(variant,platformById(variant.platformId),content,currentProfile(content));store.put('variant',variant);}});res.json(content);});
 app.delete('/api/contents/:id',(req,res)=>{const content=get<Content>('content',String(req.params.id));if(store.list<Job>('job').some(j=>j.contentId===content.id&&activeStates.includes(j.status)))throw new ApiError('该内容还有待处理的发布任务，请先处理或取消任务',409);store.transaction(()=>{store.remove('content',content.id);for(const v of store.list<Variant>('variant').filter(v=>v.contentId===content.id))store.remove('variant',v.id);});res.json({ok:true});});
 app.post('/api/contents/:id/generate',async(req,res)=>{
  const content=get<Content>('content',String(req.params.id));
  const data=z.object({platformIds:z.array(z.string()).min(1).max(platforms.length),mode:z.enum(['rules','ai']),replaceExisting:z.boolean().default(false),language:z.enum(['zh-CN','en','zh-TW']).optional()}).parse(req.body);
  const profile=currentProfile(content);
  const language=data.language||variantLanguage({body:content.source},profile);
  if(data.mode==='rules'&&data.language&&data.language!==variantLanguage({body:content.source}))throw new ApiError('规则整理不会翻译，请选择 AI 改写或复制为待编辑语言版本');
  const selected=[...new Set(data.platformIds)].map(platformById);
  const selectedVersions=()=>store.list<Variant>('variant').filter(v=>v.contentId===content.id&&data.platformIds.includes(v.platformId)&&variantLanguage(v,profile)===language);
  const existing=selectedVersions();
  if(existing.length&&!data.replaceExisting)throw new ApiError('所选平台已有版本，请只生成缺失版本，或明确选择重新生成已有版本。',409);
  // IDs and timestamps identify the baseline; the digest also catches same-millisecond edits.
  const versionBaseline=()=>JSON.stringify(selectedVersions().map(v=>[v.id,v.updatedAt,createHash('sha256').update(JSON.stringify(v)).digest('hex')]).sort((a,b)=>a[0].localeCompare(b[0])));
  const baseline=versionBaseline();
  const languageProfile=data.language?{...(profile||{id:'language-only',name:'',audience:'',tone:'',description:'',forbiddenWords:[],updatedAt:''}),language}:profile;
  const variants=data.mode==='ai'?await generateAI(content,selected,languageProfile,generationPrivate()):selected.map(p=>ruleVariant(content,p,languageProfile));
  for(const variant of variants){variant.language=language;variant.mediaIds=existing.find(v=>v.platformId===variant.platformId)?.mediaIds;variant.issues=[...validateVariant(variant,platformById(variant.platformId),content,profile),...variant.issues.filter(i=>i.severity==='warning'&&i.message.startsWith('规则适配为满足长度'))];}
  const latest=get<Content>('content',content.id);
  if(revision(latest)!==revision(content))throw new ApiError('生成期间原稿发生变化，请重新生成',409);
  if(currentProfile(latest)?.updatedAt!==profile?.updatedAt)throw new ApiError('生成期间创作画像发生变化，请重新生成',409);
  if(versionBaseline()!==baseline)throw new ApiError('生成期间平台版本发生变化，已保留最新编辑，请重新核对后生成。',409);
  store.transaction(()=>{for(const old of existing)store.remove('variant',old.id);for(const variant of variants)store.put('variant',variant);});
  res.json({variants,mode:data.mode,replacedVariantIds:existing.map(v=>v.id)});
 });
 app.post('/api/variants',(req,res)=>{
  const data=z.object({contentId:id,platformId:z.string(),language:z.enum(['zh-CN','en','zh-TW']),fromVariantId:id.optional()}).parse(req.body);
  const content=get<Content>('content',data.contentId);const platform=platformById(data.platformId);const profile=currentProfile(content);
  if(store.list<Variant>('variant').some(v=>v.contentId===content.id&&v.platformId===platform.id&&variantLanguage(v,profile)===data.language))throw new ApiError('这个平台已有对应语言版本，请编辑现有版本',409);
  const source=data.fromVariantId?get<Variant>('variant',data.fromVariantId):undefined;
  if(source&&(source.contentId!==content.id||source.platformId!==platform.id))throw new ApiError('复制版本与原稿、平台不匹配');
  const variant:Variant={...(source||ruleVariant(content,platform,profile)),id:uid(),contentId:content.id,platformId:platform.id,language:data.language,approved:false,source:'manual',updatedAt:stamp(),sourceRevision:revision(content)};
  variant.issues=validateVariant(variant,platform,content,profile);store.put('variant',variant);res.status(201).json(variant);
 });
 app.put('/api/variants/:id',(req,res)=>{const variant=get<Variant>('variant',String(req.params.id));const content=get<Content>('content',variant.contentId);const {rebase,...data}=variantSchema.parse(req.body);const textChanged=['title','body','tags','thread','language','mediaIds'].some(key=>Object.hasOwn(data,key)&&JSON.stringify((variant as any)[key])!==JSON.stringify((data as any)[key]));if(data.language&&store.list<Variant>('variant').some(v=>v.id!==variant.id&&v.contentId===content.id&&v.platformId===variant.platformId&&variantLanguage(v,currentProfile(content))===data.language))throw new ApiError('这个平台已有对应语言版本，请编辑现有版本',409);const updated:Variant={...variant,...data,approved:textChanged||rebase?false:data.approved??variant.approved,source:textChanged?'manual':variant.source,sourceRevision:textChanged||rebase?revision(content):variant.sourceRevision,updatedAt:stamp()};if(platformById(updated.platformId).category==='article')updated.html=toHtml(updated.body);updated.issues=validateVariant(updated,platformById(updated.platformId),content,currentProfile(content));if(updated.approved&&updated.issues.some(i=>i.severity==='error'))throw new ApiError('该版本存在校验错误，处理后才能审核通过');store.put('variant',updated);res.json(updated);});
 app.post('/api/profiles',(req,res)=>{const profile:Profile={...profileSchema.parse(req.body),id:uid(),updatedAt:stamp()};store.put('profile',profile);res.status(201).json(profile);});
 app.put('/api/profiles/:id',(req,res)=>{const old=get<Profile>('profile',String(req.params.id));const profile:Profile={...old,...profileSchema.parse(req.body),updatedAt:stamp()};store.transaction(()=>{store.put('profile',profile);const affected=new Set(store.list<Content>('content').filter(c=>c.profileId===profile.id).map(c=>c.id));for(const variant of store.list<Variant>('variant').filter(v=>affected.has(v.contentId))){const content=get<Content>('content',variant.contentId);store.put('variant',{...variant,approved:false,issues:validateVariant(variant,platformById(variant.platformId),content,profile)});}});res.json(profile);});
 app.delete('/api/profiles/:id',(req,res)=>{const profile=get<Profile>('profile',String(req.params.id));if(store.list<Content>('content').some(c=>c.profileId===profile.id))throw new ApiError('该画像仍被内容使用，请先修改对应内容的画像',409);store.remove('profile',profile.id);res.json({ok:true});});
 const saveConnection=(req:Request,res:Response,old?:StoredConnection)=>{
  const data=connectionSchema.parse(req.body);const platform=platformById(data.platformId);if(data.connector.startsWith('native:'))data.connector='native';
  const definition=definitionFor(data.connector,platform.id);if(!definition)throw new ApiError('该连接器不支持所选平台');
  const previous=old?rawConnection(old.id):undefined;const sameKind=old&&old.connector===data.connector&&old.platformId===data.platformId;
  const config={...(sameKind?previous?.config:{}),...data.config};
  if(sameKind)for(const key of publicConnection(old!).secretKeys)if(!data.config[key])config[key]=previous!.config[key];
  for(const key of Object.keys(config))if(!definition.fields.some(f=>f.key===key))delete config[key];
  const unchangedConfig=!!sameKind&&sameConfig(config,previous!.config);
  if(old&&store.list<Job>('job').some(j=>j.connectionId===old.id&&activeStates.includes(j.status))){
   if(!unchangedConfig)throw new ApiError('渠道仍有待处理任务，只能修改名称或启用状态；请先取消或核对任务，再修改平台、连接方式和账号配置。',409);
  }
  const saved:StoredConnection={id:old?.id||uid(),name:data.name,platformId:data.platformId,connector:data.connector,enabled:data.enabled??old?.enabled??true,createdAt:old?.createdAt||stamp(),lastTest:unchangedConfig?old?.lastTest:undefined};
  store.transaction(()=>{store.put('connection',saved);store.setSecret(`connection:${saved.id}`,config);});res.status(old?200:201).json(publicConnection(saved));
 };
 app.post('/api/connections',(req,res)=>saveConnection(req,res));
 app.put('/api/connections/:id',(req,res)=>saveConnection(req,res,get<StoredConnection>('connection',String(req.params.id))));
 app.delete('/api/connections/:id',(req,res)=>{const saved=get<StoredConnection>('connection',String(req.params.id));if(store.list<Job>('job').some(j=>j.connectionId===saved.id&&activeStates.includes(j.status)))throw new ApiError('渠道仍有待处理任务，请先取消或确认任务',409);store.transaction(()=>{store.remove('connection',saved.id);store.removeSecret(`connection:${saved.id}`);});res.json({ok:true});});
 app.post('/api/connections/:id/test',async(req,res)=>{
  const connection=rawConnection(String(req.params.id));if(!connection)throw new ApiError('渠道不存在',404);
  const platform=platformById(connection.platformId);let result:{ok:boolean;message:string};
  try{const errors=service.validateConnection(connection,platform);result=errors.length?{ok:false,message:errors.join('；')}:await service.testConnection(connection,platform);}catch(error){result={ok:false,message:error instanceof Error?error.message:'连接检查失败。'};}
  const current=rawConnection(connection.id);
  if(!current||current.platformId!==connection.platformId||current.connector!==connection.connector||!sameConfig(current.config,connection.config))throw new ApiError('检查期间渠道配置发生变化，请重新检查当前配置。',409);
  const secretConfig={...connection.config};
  for(const field of definitionFor(connection.connector,connection.platformId)?.fields||[])if(field.secret&&connection.config[field.key])secretConfig[`secret:${field.key}`]=connection.config[field.key];
  const lastTest:NonNullable<Connection['lastTest']>={at:stamp(),ok:result.ok===true,message:redactMessage(result.message,secretConfig),scope:testScope(connection)};
  const saved=get<StoredConnection>('connection',connection.id);store.put('connection',{...saved,lastTest});res.json(lastTest);
 });
 app.put('/api/settings',(req,res)=>{const data=z.object({generation:z.object({enabled:z.boolean().optional(),baseUrl:z.string().max(2000).optional(),model:z.string().max(200).optional(),apiKey:z.string().max(10000).optional(),clearApiKey:z.boolean().optional()}).optional(),timezone:z.string().max(100).optional()}).parse(req.body);const previous=generationPrivate();const updated={...previous,...data.generation,apiKey:data.generation?.clearApiKey?'':data.generation?.apiKey||previous.apiKey};if(updated.baseUrl){try{const url=new URL(updated.baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw 0;}catch{throw new ApiError('AI 服务地址必须为 HTTP(S) URL，凭证请填入 API Key 字段');}}if(data.timezone){try{new Intl.DateTimeFormat('zh-CN',{timeZone:data.timezone}).format();}catch{throw new ApiError('时区格式不正确');}}store.transaction(()=>{store.setSecret('generation',{enabled:updated.enabled,baseUrl:updated.baseUrl,model:updated.model,apiKey:updated.apiKey});if(data.timezone)store.put('setting',{id:'local',timezone:data.timezone});});res.json(settings());});
 registerPublicationRecords(app,store);
 app.post('/api/jobs/preflight',(req,res)=>{
  const data=z.object({contentId:id,targets:z.array(z.object({variantId:id,connectionId:id})).min(1).max(200)}).parse(req.body);
  const content=get<Content>('content',data.contentId);const profile=currentProfile(content);
  const seenTargets=new Set<string>();
  const checks:PublicationCheck[]=data.targets.map(target=>{
   const variant=get<Variant>('variant',target.variantId);const connection=rawConnection(target.connectionId);if(!connection)throw new ApiError('渠道不存在');
   const platform=platformById(variant.platformId);const errors:string[]=[];const warnings:string[]=[];
   if(variant.contentId!==content.id||connection.platformId!==platform.id)errors.push('内容版本和渠道不匹配');
   if(!connection.enabled)errors.push('渠道已停用');
   if(!isApprovedValid(variant,platform,content,profile))errors.push('该版本尚未确认或有未处理的校验错误');
   errors.push(...service.validateConnection(connection,platform));let media:Media[]=[];
   try{media=variantMedia(variant,content);}catch(e){errors.push((e as Error).message);}
   errors.push(...connectorMediaIssues(connection,media,access.remoteMode));
   const deliveryKey=`${connection.id}:${publicationFingerprint(variant,media)}`;
   if(seenTargets.has(deliveryKey))errors.push('本次目标中包含同一账号的重复文案与素材');
   seenTargets.add(deliveryKey);
   const saved=get<StoredConnection>('connection',connection.id);const lastTest=saved.lastTest;
   if(!lastTest)warnings.push('此连接尚未检查，请先核对平台登录与账号身份');
   else if(!lastTest.ok)errors.push('最近一次连接检查失败，请检查账号后再创建任务');
   else if(lastTest.scope==='configuration')warnings.push('这里只检查了参数，尚未验证平台登录或发布权限');
   else if(Date.now()-Date.parse(lastTest.at)>86400000)warnings.push('连接检查已超过 24 小时，请核对账号状态');
   if(store.list<Job>('job').some(j=>j.contentId===content.id&&variantSlot(j.snapshot)===variantSlot(variant,profile)&&j.connectionId===connection.id&&activeStates.includes(j.status)))errors.push('该内容、平台与渠道已有待处理任务，请先处理或取消原任务。');
   const definition=definitionFor(connection.connector,platform.id);
   const route=connection.connector==='multipost'?'browser':connection.connector==='webhook'?'custom':(definition?.mode==='draft'&&connection.config.postType!=='publish'||connection.connector==='postiz'&&connection.config.postType==='draft')?'draft':'publish';
   if(route==='draft')warnings.push('此连接保存平台草稿，最终发送需要在平台后台完成');
   const previous=priorPublications(variant,media,connection.id,store.list<Job>('job')).map(j=>({id:j.id,status:j.status,accountName:j.connectionName,url:j.url}));
   if(previous.length)warnings.push('这个账号已有相同文案与素材的记录，请先核对，避免重复发送');
   return {variantId:variant.id,connectionId:connection.id,platformId:platform.id,title:variant.title,language:variantLanguage(variant,profile),accountName:connection.name,route,media,errors,warnings,previous,lastTest};
  });res.json({checks,ready:checks.every(check=>!check.errors.length)});
 });
 app.post('/api/jobs',(req,res)=>{
  const data=z.object({contentId:id,targets:z.array(z.object({variantId:id,connectionId:id})).min(1).max(200),scheduledAt:z.string().datetime({offset:true}).optional(),allowDuplicate:z.boolean().optional()}).parse(req.body);
  const key=req.header('Idempotency-Key');if(key&&key.length>200)throw new ApiError('幂等标识过长');const fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  if(key){const previous=store.idempotency(key);if(previous){if(previous.fingerprint!==fingerprint)throw new ApiError('该请求标识已用于不同发布内容',409);res.json({jobs:previous.jobs.map(value=>get<Job>('job',value))});return;}}
  const content=get<Content>('content',data.contentId);const profile=currentProfile(content);const batchId=uid();const now=stamp();const scheduledAt=data.scheduledAt||now;if(data.scheduledAt&&new Date(data.scheduledAt).getTime()<Date.now()-5000)throw new ApiError('排期时间已经过去');const seen=new Set<string>();
  const jobs=data.targets.map(target=>{const variant=get<Variant>('variant',target.variantId);const connection=rawConnection(target.connectionId);if(!connection)throw new ApiError('渠道不存在');const platform=platformById(variant.platformId);if(variant.contentId!==content.id||connection.platformId!==platform.id)throw new ApiError('内容版本和渠道不匹配');if(!connection.enabled)throw new ApiError('渠道已停用');if(!isApprovedValid(variant,platform,content,profile))throw new ApiError(`${platform.name} 版本尚未审核通过或原稿已变化`);const errors=service.validateConnection(connection,platform);if(errors.length)throw new ApiError(`${connection.name}：${errors.join('；')}`);const media=variantMedia(variant,content);const mediaErrors=connectorMediaIssues(connection,media,access.remoteMode);if(mediaErrors.length)throw new ApiError(mediaErrors.join('；'));const saved=get<StoredConnection>('connection',connection.id);if(saved.lastTest?.ok===false)throw new ApiError('最近一次连接检查失败，请检查账号后再创建任务');if(!data.allowDuplicate&&priorPublications(variant,media,connection.id,store.list<Job>('job')).length)throw new ApiError('这个账号已有相同文案与素材的记录，请先核对，避免重复发送',409);const identity=`${connection.id}:${publicationFingerprint(variant,media)}`;if(seen.has(identity))throw new ApiError('发布目标重复');seen.add(identity);if(store.list<Job>('job').some(j=>j.contentId===content.id&&variantSlot(j.snapshot,profile)===variantSlot(variant,profile)&&j.connectionId===connection.id&&activeStates.includes(j.status)))throw new ApiError('该内容、平台与渠道已有待处理任务，请先处理或取消原任务。',409);const job:Job={id:uid(),batchId,contentId:content.id,variantId:variant.id,connectionId:connection.id,platformId:platform.id,connectionName:connection.name,title:variant.title,status:new Date(scheduledAt).getTime()>Date.now()?'scheduled':'queued',scheduledAt,attempts:0,message:data.scheduledAt?'等待排期时间':'等待执行',createdAt:now,updatedAt:now,snapshot:{...variant,language:variantLanguage(variant,profile)},media};return job;});
  store.transaction(()=>{for(const job of jobs)store.put('job',job);if(key)store.saveIdempotency(key,fingerprint,jobs.map(j=>j.id));});res.status(201).json({jobs});void queue.tick();
 });
 app.post('/api/jobs/:id/cancel',(req,res)=>{const job=get<Job>('job',String(req.params.id));if(!['queued','scheduled','needs_action'].includes(job.status))throw new ApiError('该任务已经执行，无法撤销远端发布请求',409);const updated:Job={...job,status:'cancelled',message:'已取消本地待执行任务',updatedAt:stamp()};store.put('job',updated);res.json(updated);});
 app.post('/api/jobs/:id/retry',(req,res)=>{const job=get<Job>('job',String(req.params.id));if(job.origin==='external')throw new ApiError('浏览器发布记录只能更新结果，不能通过队列重发',409);if(!['failed','unconfirmed','cancelled'].includes(job.status))throw new ApiError('该状态不可重试',409);if(store.list<Job>('job').some(j=>j.id!==job.id&&j.contentId===job.contentId&&variantSlot(j.snapshot)===variantSlot(job.snapshot)&&j.connectionId===job.connectionId&&activeStates.includes(j.status)))throw new ApiError('该内容、平台与渠道已有其他待处理任务。',409);const connection=rawConnection(job.connectionId);if(!connection?.enabled)throw new ApiError('请先启用有效的渠道连接');const errors=service.validateConnection(connection,platformById(job.platformId));if(errors.length)throw new ApiError(errors.join('；'));const now=stamp();const updated:Job={...job,id:uid(),batchId:uid(),status:'queued',scheduledAt:now,attempts:0,remoteId:undefined,url:undefined,message:'用户明确发起重试；使用原任务的已审核快照',createdAt:now,updatedAt:now};store.put('job',updated);res.status(201).json(updated);void queue.tick();});
 app.post('/api/jobs/:id/confirm',(req,res)=>{
  const job=get<Job>('job',String(req.params.id));
  if(!['needs_action','unconfirmed','submitted','blocked'].includes(job.status)&&job.origin!=='external')throw new ApiError('该任务无需人工确认',409);
  const data=resultSchema.parse(req.body);const proofMedia=resultProof(store,data,job.proofMedia);
  const url=data.url||job.url;
  if(job.origin==='external')checkExternalResult({...data,url},proofMedia);
  const updated:Job={...job,status:data.outcome,url,proofMedia,message:`用户已核对远端结果：${data.message||outcomeLabels[data.outcome]}`,updatedAt:stamp()};
  updated.resultHistory=[...(job.resultHistory||[{status:job.status,message:job.message,url:job.url,at:job.updatedAt}]),{status:updated.status,message:updated.message,url:updated.url,at:updated.updatedAt}];
  store.put('job',updated);res.json(updated);
 });
 app.post('/api/jobs/:id/bridge',(req,res)=>{const job=get<Job>('job',String(req.params.id));if(job.status!=='needs_action'||rawConnection(job.connectionId)?.connector!=='multipost')throw new ApiError('该任务不是待交接的浏览器任务',409);const data=z.object({outcome:z.enum(['dispatched','failed','unconfirmed']),message:z.string().max(1000).optional()}).parse(req.body);const updated:Job={...job,status:data.outcome==='failed'?'failed':data.outcome==='unconfirmed'?'unconfirmed':'needs_action',message:data.message||(data.outcome==='dispatched'?'已交接到浏览器扩展，请完成发布后核对结果':data.outcome==='unconfirmed'?'扩展交接结果未知，内容可能已被接收。请先核对扩展窗口和目标平台，不要重复交接。':'扩展明确拒绝交接或内容未被发送，请检查配置。'),updatedAt:stamp()};store.put('job',updated);res.json(updated);});
 app.get('/api/contents/:id/export',async(req,res)=>{const content=get<Content>('content',String(req.params.id));const platformId=String(req.query.platformId||'');const candidates=store.list<Variant>('variant').filter(v=>v.contentId===content.id&&(req.query.variantId?v.id===String(req.query.variantId):v.platformId===platformId));if(candidates.length>1)throw new ApiError('该平台有多个语言版本，请指定版本导出');const variant=candidates[0];if(!variant)throw new ApiError('内容版本不存在',404);const format=String(req.query.format||'markdown');if(!['markdown','html','json'].includes(format))throw new ApiError('不支持的导出格式');const ext=format==='markdown'?'md':format;res.setHeader('Content-Disposition',`attachment; filename="${variant.platformId}-${content.id}.${ext}"`);if(format==='json'){res.json(variant);return;}if(format==='html'){res.type('html').send(await portableArticle(variant,content,m=>readMedia(store,m)));return;}res.type('text/markdown').send(`# ${variant.title}\n\n${variant.thread.length?variant.thread.join('\n\n---\n\n'):variant.body}`);});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1}});
 app.post('/api/uploads',upload.single('file'),async(req,res)=>{const file=req.file;if(!file)throw new ApiError('请上传一个文件');const detected=detectMedia(file.buffer);if(!detected)throw new ApiError('只支持 PNG、JPEG、WebP、GIF、MP4 或 PDF 文件');const value=uid();const filename=`${value}.${detected.ext}`;await writeFile(join(store.uploadDir,filename),file.buffer,{mode:0o600,flag:'wx'});const media:Media={id:value,name:file.originalname.replace(/[\r\n]/g,'').slice(0,200),url:`/uploads/${filename}`,mime:detected.mime,size:file.size};store.put('media',media);res.status(201).json(media);});
 app.use(['/api','/uploads'],(_req,res)=>{res.status(404).json({error:'接口不存在'});});
 const dist=options.staticDir?resolve(options.staticDir):resolve('client/dist');if(existsSync(join(dist,'index.html'))){app.use(express.static(dist,{index:false}));app.get('/{*path}',(_req,res)=>{res.sendFile(join(dist,'index.html'));});}
 app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{const status=error instanceof ApiError?error.status:error instanceof multer.MulterError?400:error instanceof z.ZodError?400:400;let message=error instanceof z.ZodError?error.issues.map(i=>i.message).join('；'):error instanceof Error?error.message:'请求失败';for(const saved of store.list<StoredConnection>('connection'))message=redactMessage(message,rawConnection(saved.id)?.config);message=redactMessage(message,{apiKey:generationPrivate().apiKey});res.status(status).json({error:message});});
 return {app,store,queue,close:()=>{queue.stop();store.close();}};
}
function detectMedia(bytes:Buffer):{mime:string;ext:string}|undefined {if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'png'};if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:'image/jpeg',ext:'jpg'};if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'webp'};if(['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return {mime:'image/gif',ext:'gif'};if(bytes.toString('ascii',4,8)==='ftyp')return {mime:'video/mp4',ext:'mp4'};if(bytes.toString('ascii',0,5)==='%PDF-')return {mime:'application/pdf',ext:'pdf'};}
