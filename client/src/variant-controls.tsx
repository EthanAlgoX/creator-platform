import type {Media} from './api';
import {mediaUrl} from './urls';
import {t} from './i18n';
import {Button} from './ui';
import {ArrowDown,ArrowUp,Files} from 'lucide-react';

export const languageLabel=(language:string)=>language==='en'?'English':language==='zh-TW'?t('繁体中文'):language==='zh-CN'?t('简体中文'):language;
export function LanguageOptions({disabled=[]}:{disabled?:string[]}={}){return <><option value="zh-CN" disabled={disabled.includes('zh-CN')}>{t('简体中文')}</option><option value="en" disabled={disabled.includes('en')}>English</option><option value="zh-TW" disabled={disabled.includes('zh-TW')}>{t('繁体中文')}</option></>;}
export function VariantMediaEditor({media,ids,onChange,onInsert,disabled}:{media:Media[];ids?:string[];onChange:(ids:string[])=>void;onInsert?:(media:Media)=>void;disabled:boolean}){
 const selected=ids||media.map(m=>m.id);const sorted=[...selected.map(id=>media.find(m=>m.id===id)).filter((m):m is Media=>!!m),...media.filter(m=>!selected.includes(m.id))];
 const missing=selected.some(id=>!media.some(m=>m.id===id));
 const move=(id:string,direction:number)=>{const list=[...selected];const index=list.indexOf(id);const destination=index+direction;if(index<0||destination<0||destination>=list.length)return;[list[index],list[destination]]=[list[destination],list[index]];onChange(list);};
 return <section className="version-media-editor" aria-label={t('此版本的素材与顺序')}><div className="section-label"><h3>{t('此版本的素材与顺序')}</h3><span>{t('已选择 {count} 个',{count:selected.length})}</span></div><p className="field-hint">{t('分别选择中英文配图。第一张图片作为首图；封面支持取决于发布连接。')}</p>{missing&&<Button onClick={()=>onChange(selected.filter(id=>media.some(m=>m.id===id)))} disabled={disabled}>{t('移除失效素材引用')}</Button>}{!media.length?<p className="field-hint">{t('先在原稿中添加素材，再为各版本选择。')}</p>:<ul>{sorted.map(m=>{const index=selected.indexOf(m.id);const checked=index>=0;return <li key={m.id}><label><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked?[...selected,m.id]:selected.filter(id=>id!==m.id))}/>{m.mime.startsWith('image/')?<img src={mediaUrl(m.url)} alt=""/>:<Files size={24}/>}<span>{m.name}{checked&&<small>{t('第 {count} 个',{count:index+1})}</small>}</span></label><div className="version-media-actions">{checked&&<><Button className="quiet" aria-label={t('上移 {name}',{name:m.name})} onClick={()=>move(m.id,-1)} disabled={disabled||index===0}><ArrowUp size={15}/></Button><Button className="quiet" aria-label={t('下移 {name}',{name:m.name})} onClick={()=>move(m.id,1)} disabled={disabled||index===selected.length-1}><ArrowDown size={15}/></Button>{onInsert&&m.mime.startsWith('image/')&&<Button className="quiet" onClick={()=>onInsert(m)} disabled={disabled}>{t('插入正文')}</Button>}</>}</div></li>;})}</ul>}</section>;
}
