import {createHash,randomUUID} from 'node:crypto';
import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';
import type {Content,Platform,Profile,Variant,Issue,Media} from './types.js';
export const stamp=()=>new Date().toISOString();
export const uid=()=>randomUUID();
export function revision(content:Content){return createHash('sha256').update(JSON.stringify([content.title,content.source,content.profileId,content.media])).digest('hex');}
export const length=(s:string)=>Array.from(s).length;
export function countFor(platform:Platform,text:string):number {
 if(platform.id==='x') {
  // Conservative approximation of X weighted text: CJK/emoji weigh two, URLs 23.
  let total=0;for(const part of text.split(/(https?:\/\/[^\s]+)/g)){if(/^https?:\/\//.test(part)){total+=23;continue;}for(const char of part){const code=char.codePointAt(0)!;total+=code<=0x10ff||(code>=0x2000&&code<=0x200d)||(code>=0x2010&&code<=0x201f)||(code>=0x2032&&code<=0x2037)?1:2;}}return total;
 }
 if(platform.id==='bluesky')return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length;
 return length(text);
}
function cut(text:string,limit:number,platform?:Platform):string {let output='';for(const char of text){if((platform?countFor(platform,output+char+'…'):length(output+char+'…'))>limit)break;output+=char;}return output===text?text:output.trimEnd()+'…';}
export function splitThread(text:string,platform:Platform):string[] {
 const limit=platform.bodyLimit-18;const chunks:string[]=[];let chunk='';
 // Keep complete URL tokens together so weighted length remains valid.
 for(const token of text.match(/https?:\/\/[^\s]+|[^]/gu)||[]) {if(countFor(platform,chunk+token)>limit){if(chunk.trim())chunks.push(chunk.trim());chunk=token;}else chunk+=token;}
 if(chunk.trim())chunks.push(chunk.trim());return chunks.length>1?chunks.map((p,i)=>`${p}\n\n${i+1}/${chunks.length}`):chunks;
}
export function toHtml(markdown:string):string {
 const html=marked.parse(markdown,{async:false,gfm:true}) as string;
 const styles:Record<string,string>={p:'margin:16px 0;line-height:1.85;color:#26352f;font-size:16px;',h1:'font-size:26px;line-height:1.5;margin:28px 0 16px;font-weight:700;',h2:'font-size:21px;line-height:1.6;margin:26px 0 12px;font-weight:700;',h3:'font-size:18px;line-height:1.6;margin:20px 0 10px;font-weight:700;',blockquote:'margin:18px 0;padding:12px 16px;border-left:3px solid #176b52;background:#f3f7f5;',ul:'padding-left:24px;line-height:1.85;',ol:'padding-left:24px;line-height:1.85;',li:'margin:8px 0;line-height:1.85;',pre:'padding:14px;background:#f3f5f4;overflow:auto;white-space:pre-wrap;',code:'font-family:monospace;font-size:14px;',a:'color:#176b52;text-decoration:underline;',img:'max-width:100%;height:auto;',table:'border-collapse:collapse;width:100%;',th:'padding:8px;border:1px solid #d9e3de;',td:'padding:8px;border:1px solid #d9e3de;'};
 return sanitizeHtml(html,{allowedTags:['p','br','h1','h2','h3','h4','strong','em','blockquote','ul','ol','li','pre','code','a','img','table','thead','tbody','tr','th','td','hr'],allowedAttributes:{a:['href','title','style'],img:['src','alt','style'],'*':['style']},allowedSchemes:['http','https'],allowProtocolRelative:false,transformTags:Object.fromEntries(Object.entries(styles).map(([tag,style])=>[tag,(_tag:string,attributes:Record<string,string>)=>({tagName:tag,attribs:{...attributes,style}})]))});
}
export function validateVariant(variant:Variant,platform:Platform,content:Content,profile?:Profile):Issue[] {
 const issues:Issue[]=[];const error=(message:string)=>issues.push({severity:'error',message});
 if(platform.titleLimit&&length(variant.title)>platform.titleLimit)error(`标题超过 ${platform.titleLimit} 字符`);
 if(platform.titleLimit&&!variant.title.trim())error('该平台需要标题');
 const texts=platform.id==='x'&&variant.thread.length?variant.thread:[variant.body];
 for(const [i,text] of texts.entries()){
  const label=texts.length>1?`第 ${i+1} 条串帖`:'正文';
  if(!text.trim())error(`${label}不能为空`);
  if(countFor(platform,text)>platform.bodyLimit)error(`${label}超过 ${platform.bodyLimit} 字符限制`);
 }
 if(platform.requiredMedia==='image'&&!content.media.some(m=>m.mime.startsWith('image/')))error('该平台需要至少一张图片');
 if(platform.requiredMedia==='video'&&!content.media.some(m=>m.mime.startsWith('video/')))error('该平台需要视频素材');
 if(platform.requiredMedia==='any'&&!content.media.some(m=>/^(image|video)\//.test(m.mime)))error('该平台需要图片或视频素材');
 if(profile)for(const word of profile.forbiddenWords)if(word&&`${variant.title}\n${variant.body}\n${variant.thread.join('\n')}`.includes(word))error(`包含画像中的禁用词：${word}`);
 if(variant.sourceRevision&&variant.sourceRevision!==revision(content))error('原稿已修改，请重新生成或保存这个平台版本');
 if(platform.id==='x')issues.push({severity:'warning',message:'X 字数采用保守加权估计；实际发布以平台校验为准。'});
 if(platform.id==='wechat')issues.push({severity:'warning',message:'当前公众号连接器主要写入草稿箱，最终发布请在公众号后台完成。'});
 if(platform.category==='video')issues.push({severity:'warning',message:'这是视频文案；请确认上传视频与脚本对应。'});
 return issues;
}
export function ruleVariant(content:Content,platform:Platform,profile?:Profile):Variant {
 const original=content.source.trim();let body=original;const title=cut(content.title||original.split(/\n|[。！？.!?]/)[0],platform.titleLimit||100);
 const requestedLanguage=profile?.language.trim().toLowerCase();
 const english=requestedLanguage ? /^(en(?:-[a-z]+)?|english|英文|英语)$/.test(requestedLanguage) : !/[\u4e00-\u9fff]/.test(original);
 const chinese=requestedLanguage ? /^(zh(?:-[a-z]+)?|chinese|中文|简体中文|繁体中文)$/.test(requestedLanguage) : !english;
 let thread:string[]=[];let tags:string[]=[];
 if(platform.id==='x'){thread=splitThread(original,platform);body=thread[0]||'';}
 else if(platform.id==='xiaohongshu'){body=original.replace(/\n{3,}/g,'\n\n').replace(/([。！？])(?=\S)/g,'$1\n\n');body=cut(body,960);const hashtags=[...original.matchAll(/#([^\s#]+)/g)].map(m=>m[1]);tags=[...new Set(hashtags)].slice(0,5);}
 else if(platform.id==='reddit'&&!/[?？]\s*$/.test(body)&&(english||chinese)){body=`${body}\n\n${english?'What has your experience been?':'你有什么相关经验或不同看法？'}`;}
 else if(platform.id==='linkedin'){body=`${title}\n\n${body}`;}
 else if(platform.category==='video'){body=`${title}\n\n${body}${english||chinese?`\n\n${english?'Video notes: keep the opening concise and demonstrate the key point.':'视频说明：开场直接提出主题，正文展示关键步骤，结尾回到核心观点。'}`:''}`;}
 if(platform.id!=='x'&&countFor(platform,body)>platform.bodyLimit)body=cut(body,platform.bodyLimit,platform);
 const variant:Variant={id:uid(),contentId:content.id,platformId:platform.id,title,body,tags,thread,source:'rules',issues:[],approved:false,updatedAt:stamp(),sourceRevision:revision(content)};
 if(platform.category==='article')variant.html=toHtml(body);
 variant.issues=validateVariant(variant,platform,content,profile);
 if(platform.id!=='x'&&countFor(platform,original)>platform.bodyLimit)variant.issues.push({severity:'warning',message:'规则适配为满足长度保留了原稿前半部分，请检查信息是否完整，或使用 AI 改写。'});
 return variant;
}
export function isApprovedValid(variant:Variant,platform:Platform,content:Content,profile?:Profile){return variant.approved&&!validateVariant(variant,platform,content,profile).some(i=>i.severity==='error');}
export function safeMedia(input:Media[],known:Media[]):Media[]{return input.map(m=>{const saved=known.find(a=>a.id===m.id);if(!saved)throw new Error('素材不存在，请重新上传');return saved;});}
