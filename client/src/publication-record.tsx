import {useRef,useState} from 'react';
import type {FormEvent} from 'react';
import type {Bootstrap,Job,Media} from './api';
import {errorText,request,send} from './api';
import {mediaUrl} from './urls';
import {t} from './i18n';
import {Button,ErrorMessage,Field,Modal} from './ui';

import {variantLanguage} from '../../server/variant-options.js';
import {languageLabel} from './variant-controls';

export type RecordedOutcome='published'|'submitted'|'drafted'|'blocked'|'failed';
export function OutcomeOptions(){return <><option value="published">{t('已在平台正式发布')}</option><option value="submitted">{t('已提交，等待平台审核')}</option><option value="drafted">{t('仅保存为平台草稿')}</option><option value="blocked">{t('尚未发送，需处理阻塞')}</option><option value="failed">{t('确认未发布或操作失败')}</option></>;}

export function ProofPicker({proof,onChange,disabled,onBusy,onError}:{proof:Media[];onChange:(proof:Media[])=>void;disabled:boolean;onBusy:(busy:boolean)=>void;onError:(message:string)=>void}){
 const [uploading,setUploading]=useState(false);
 return <div className="publication-proof"><Field label={t('发布凭证（可选）')} hint={t('上传平台成功页或审核状态截图，最多 5 张。凭证不会附到宣传正文。')}><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={disabled||uploading||proof.length>=5} onChange={async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  setUploading(true);onBusy(true);
  try{const form=new FormData();form.set('file',file);const saved=await request<Media>('/api/uploads',{method:'POST',body:form});if(!saved.mime.startsWith('image/'))throw new Error(t('发布凭证只支持图片'));onChange([...proof,saved]);}
  catch(e){onError(errorText(e));}finally{setUploading(false);onBusy(false);}
 }}/></Field>{proof.length>0&&<ul className="publication-proof-list">{proof.map(media=><li key={media.id}><a href={mediaUrl(media.url)} target="_blank" rel="noreferrer"><img src={mediaUrl(media.url)} alt={media.name}/><span>{media.name}</span></a><Button className="quiet" disabled={disabled||uploading} onClick={()=>onChange(proof.filter(m=>m.id!==media.id))}>{t('移除')}</Button></li>)}</ul>}</div>;
}

export function PublicationRecord({data,initialVariantId,close,onSaved,onDirtyChange}:{data:Bootstrap;initialVariantId?:string;close:()=>void;onSaved:(job:Job)=>Promise<void>;onDirtyChange:(dirty:boolean)=>void}){
 const variants=data.variants.filter(v=>v.approved&&!v.issues.some(i=>i.severity==='error')&&data.contents.some(c=>c.id===v.contentId));
 const [variantId,setVariantId]=useState(initialVariantId&&variants.some(v=>v.id===initialVariantId)?initialVariantId:variants[0]?.id||'');
 const [accountName,setAccountName]=useState('');const [outcome,setOutcome]=useState<RecordedOutcome|''>('');
 const [url,setUrl]=useState('');const [message,setMessage]=useState('');const [proof,setProof]=useState<Media[]>([]);
 const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState(false);const [dirty,setDirty]=useState(false);const [error,setError]=useState('');
 const pending=useRef<{fingerprint:string;key:string}|undefined>(undefined);
 const changed=()=>{setDirty(true);onDirtyChange(true);};
 const dismiss=()=>{if(busy||uploading)return;if(dirty&&!window.confirm(t('放弃尚未保存的结果记录？')))return;onDirtyChange(false);close();};
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(!outcome||busy||uploading)return;setBusy(true);setError('');
  const payload={variantId,accountName:accountName.trim(),outcome,url:url.trim()||undefined,message:message.trim()||undefined,proofMediaIds:proof.map(m=>m.id)};
  const fingerprint=JSON.stringify(payload);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,key:crypto.randomUUID()};
  try{const job=await send<Job>('/api/publication-records',payload,'POST',{'Idempotency-Key':pending.current.key});onDirtyChange(false);await onSaved(job);}
  catch(e){setError(errorText(e));}finally{setBusy(false);}
 };
 const locked=busy||uploading;
 return <Modal title={t('记录浏览器发布结果')} close={dismiss}><form className="management-form" onSubmit={submit}><p className="management-hint">{t('把在浏览器或平台后台完成的操作记入工作台。这里保存记录，不会发送内容。')}</p>{error&&<ErrorMessage>{error}</ErrorMessage>}
  {!variants.length?<p>{t('先确认一个平台版本，再记录发布结果。')}</p>:<>
  <Field label={t('已确认的内容版本')}><select value={variantId} onChange={e=>{setVariantId(e.target.value);changed();}} disabled={locked} required>{variants.map(v=><option key={v.id} value={v.id}>{data.platforms.find(p=>p.id===v.platformId)?.name||v.platformId} · {languageLabel(variantLanguage(v))} · {data.contents.find(c=>c.id===v.contentId)?.title} · {v.title}</option>)}</select></Field>
  <Field label={t('实际发布账号')}><input value={accountName} onChange={e=>{setAccountName(e.target.value);changed();}} maxLength={100} required disabled={locked} placeholder={t('填写平台上显示的账号名称')}/></Field>
  <Field label={t('你实际核实的结果')}><select value={outcome} onChange={e=>{setOutcome(e.target.value as RecordedOutcome);changed();}} required disabled={locked}><option value="" disabled>{t('请选择核实结果')}</option><OutcomeOptions/></select></Field>
  <Field label={t('远端链接（可选）')} hint={outcome==='published'?t('已发布需提供帖子链接或成功截图。'):undefined}><input type="url" value={url} onChange={e=>{setUrl(e.target.value);changed();}} disabled={locked} placeholder="https://…"/></Field>
  <Field label={['blocked','failed'].includes(outcome)?t('未发送原因与下一步'):t('核实备注（可选）')}><textarea rows={3} maxLength={1000} value={message} onChange={e=>{setMessage(e.target.value);changed();}} disabled={locked} required={['blocked','failed'].includes(outcome)}/></Field>
  <ProofPicker proof={proof} onChange={p=>{setProof(p);changed();}} disabled={locked} onBusy={setUploading} onError={setError}/>
  </>}<div className="management-form-actions"><Button onClick={dismiss} disabled={locked}>{t('取消')}</Button><Button className="primary" type="submit" busy={busy} disabled={locked||!variantId||!outcome||!accountName.trim()}>{t('记录结果')}</Button></div>
 </form></Modal>;
}
