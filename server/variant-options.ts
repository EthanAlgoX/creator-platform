import type {Content,Media,Profile,Variant} from './types.js';

export function normalizeLanguage(language:string):string {
 const value=language.trim().toLowerCase();
 if(/^(en(?:-[a-z]+)?|english|英文|英语)$/.test(value))return 'en';
 if(/^(zh-tw|zh-hk|繁体中文)$/.test(value))return 'zh-TW';
 if(/^(zh(?:-[a-z]+)?|chinese|中文|简体中文)$/.test(value))return 'zh-CN';
 return value;
}
export function variantLanguage(variant:Pick<Variant,'body'|'language'>,profile?:Profile):string {
 return normalizeLanguage(variant.language||profile?.language||(/[\u4e00-\u9fff]/.test(variant.body)?'zh-CN':'en'));
}
export function variantMedia(variant:Pick<Variant,'mediaIds'>,content:Pick<Content,'media'>):Media[] {
 if(variant.mediaIds===undefined)return content.media;
 if(new Set(variant.mediaIds).size!==variant.mediaIds.length)throw new Error('版本素材重复，请重新选择配图');
 return variant.mediaIds.map(id=>{const media=content.media.find(m=>m.id===id);if(!media)throw new Error('版本素材已移除，请重新选择配图');return media;});
}
export function variantSlot(variant:Pick<Variant,'platformId'|'body'|'language'>,profile?:Profile):string {
 return `${variant.platformId}:${variantLanguage(variant,profile)}`;
}
