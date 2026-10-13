import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Express} from 'express';
import type {Store} from './storage.js';
import type {Content,Job,Media,Profile,Variant} from './types.js';
import {isApprovedValid,safeMedia,stamp,uid} from './domain.js';
import {variantMedia,variantLanguage} from './variant-options.js';
import {platformById} from './catalog.js';

export const resultSchema=z.object({
 outcome:z.enum(['published','submitted','drafted','blocked','failed']),
 url:z.string().url().max(2000).refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;},'结果链接必须为不含账号密码的 HTTP(S) 地址').optional(),
 message:z.string().trim().max(1000).optional(),
 proofMediaIds:z.array(z.string().uuid()).max(5).optional(),
});
export const outcomeLabels={published:'已发布',submitted:'已提交，等待平台审核',drafted:'已存草稿',blocked:'尚未发送，需处理阻塞',failed:'未成功'};
export function resultProof(store:Store,data:z.infer<typeof resultSchema>,previous:Media[]=[]) {
 const proof=data.proofMediaIds===undefined?previous:safeMedia(data.proofMediaIds.map(id=>({id} as Media)),store.list<Media>('media'));
 if(proof.some(m=>!m.mime.startsWith('image/')))throw new Error('发布凭证只支持图片');
 return proof;
}
export function checkExternalResult(data:z.infer<typeof resultSchema>,proof:Media[]) {
 if(data.outcome==='published'&&!data.url&&!proof.length)throw new Error('已发布记录需要帖子链接或发布成功截图');
 if(['blocked','failed'].includes(data.outcome)&&!data.message)throw new Error('请填写未发送的原因和下一步处理方式');
}

/** Records a browser/manual outcome only. Never enqueues a publishing request. */
export function registerPublicationRecords(app:Express,store:Store) {
 const schema=resultSchema.extend({variantId:z.string().uuid(),accountName:z.string().trim().min(1).max(100)});
 app.post('/api/publication-records',(req,res)=>{
  const data=schema.parse(req.body);const key=req.header('Idempotency-Key');
  if(key&&key.length>200)throw new Error('幂等标识过长');
  const fingerprint=createHash('sha256').update(JSON.stringify(['external',data])).digest('hex');
  if(key){const previous=store.idempotency(key);if(previous){if(previous.fingerprint!==fingerprint){res.status(409).json({error:'该请求标识已用于不同发布内容'});return;}res.json(store.get<Job>('job',previous.jobs[0]));return;}}
  const variant=store.get<Variant>('variant',data.variantId);const content=variant&&store.get<Content>('content',variant.contentId);
  if(!variant||!content){res.status(404).json({error:'内容版本不存在'});return;}
  const profile=content.profileId?store.get<Profile>('profile',content.profileId):undefined;
  if(!isApprovedValid(variant,platformById(variant.platformId),content,profile))throw new Error('请先确认平台版本，再记录对应发布结果');
  const proofMedia=resultProof(store,data);checkExternalResult(data,proofMedia);
  const connectionId=`external:${createHash('sha256').update(JSON.stringify([variant.platformId,data.accountName])).digest('hex')}`;
  if(store.list<Job>('job').some(j=>j.origin==='external'&&j.variantId===variant.id&&j.connectionId===connectionId)){
   res.status(409).json({error:'这个版本与账号已有发布记录，请更新原记录的结果'});return;
  }
  const now=stamp();const job:Job={id:uid(),batchId:uid(),contentId:content.id,variantId:variant.id,platformId:variant.platformId,connectionId,connectionName:data.accountName,title:variant.title,
   status:data.outcome,origin:'external',scheduledAt:now,attempts:0,createdAt:now,updatedAt:now,snapshot:{...variant,language:variantLanguage(variant,profile)},media:variantMedia(variant,content),proofMedia,url:data.url,
   message:`已记录平台实际结果：${data.message||outcomeLabels[data.outcome]}`};
  job.resultHistory=[{status:job.status,message:job.message,url:job.url,at:now}];
  store.transaction(()=>{store.put('job',job);if(key)store.saveIdempotency(key,fingerprint,[job.id]);});
  res.status(201).json(job);
 });
}
