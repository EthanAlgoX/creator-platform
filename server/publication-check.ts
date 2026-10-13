import {createHash} from 'node:crypto';
import type {Connection,Content,Job,Media,Variant} from './types.js';

export function publicationFingerprint(variant:Variant,media:Media[]):string {
 return createHash('sha256').update(JSON.stringify([variant.platformId,variant.title,variant.body,variant.tags,variant.thread,media.map(m=>m.id)])).digest('hex');
}
export function priorPublications(variant:Variant,media:Media[],connectionId:string,jobs:Job[]):Job[] {
 const fingerprint=publicationFingerprint(variant,media);
 return jobs.filter(j=>(j.connectionId===connectionId||j.origin==='external'&&j.platformId===variant.platformId)&&['published','submitted','unconfirmed','needs_action','drafted'].includes(j.status)&&publicationFingerprint(j.snapshot,j.media)===fingerprint);
}
export function connectorMediaIssues(connection:Pick<Connection,'connector'|'platformId'|'config'>,media:Media[],protectedMedia:boolean):string[] {
 const issues:string[]=[];
 if(connection.connector==='native'&&connection.platformId==='x'&&(media.length>4||media.some(m=>!m.mime.startsWith('image/'))))issues.push('X 当前连接支持最多 4 张图片，请调整这个版本的素材');
 if(connection.connector==='xiaohongshu'){
  if(connection.config.format==='video'){
   if(media.length!==1||media[0]?.mime!=='video/mp4')issues.push('小红书视频需单个已上传的 MP4，不支持同时附带图片或其他素材。');
  }else if(!media.length||media.length>18||media.some(m=>!m.mime.startsWith('image/')))issues.push('小红书图文需要 1 至 18 张图片，暂不支持其他附件。');
 }
 if(connection.connector==='wechatsync'&&media.some(m=>!m.mime.startsWith('image/')))issues.push('Wechatsync 文章连接只支持图片素材');
 if(protectedMedia&&media.some(m=>m.url.startsWith('/uploads/'))&&(['multipost','wechatsync','webhook'].includes(connection.connector)||connection.connector==='xiaohongshu'&&connection.config.format!=='video'))issues.push('当前素材需要登录，目标服务不能直接下载，请使用支持直接文件上传的连接器。');
 return issues;
}
export type PublicationCheck={variantId:string;connectionId:string;platformId:string;title:string;language:string;accountName:string;route:'publish'|'draft'|'browser'|'custom';media:Media[];errors:string[];warnings:string[];previous:{id:string;status:Job['status'];accountName:string;url?:string}[];lastTest?:Connection['lastTest']};
