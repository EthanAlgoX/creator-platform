import type {Content,Variant,Media} from './types.js';
import {variantMedia,variantLanguage} from './variant-options.js';
import {toHtml} from './domain.js';

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Local images travel with the export; linked article images keep their position. */
export async function portableArticle(variant:Variant,content:Content,read:(media:Media)=>Promise<Uint8Array>):Promise<string> {
 const media=variantMedia(variant,content);
 let html=toHtml(variant.body);
 const referenced=new Set([...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]));
 for(const url of referenced)if(url.startsWith('/uploads/')&&!media.some(m=>m.url===url&&m.mime.startsWith('image/')))throw new Error('正文引用了未关联的图片，请在原稿素材中添加对应图片');
 for(const item of media.filter(m=>m.mime.startsWith('image/'))){
  const bytes=await read(item);const data=`data:${item.mime};base64,${Buffer.from(bytes).toString('base64')}`;
  if(referenced.has(item.url))html=html.split(`src="${escape(item.url)}"`).join(`src="${data}"`);
  else html+=`<figure style="margin:24px 0"><img src="${data}" alt="${escape(item.name)}" style="max-width:100%;height:auto"></figure>`;
 }
 return `<!doctype html><html lang="${escape(variantLanguage(variant))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(variant.title)}</title></head><body style="font-family:system-ui,sans-serif;margin:0"><article style="max-width:680px;margin:auto;padding:24px;overflow-wrap:anywhere"><h1>${escape(variant.title)}</h1>${html}</article></body></html>`;
}
