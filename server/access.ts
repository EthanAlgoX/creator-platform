import {timingSafeEqual} from 'node:crypto';
import type {Request,Response,NextFunction} from 'express';

const loopbackHosts=['localhost','127.0.0.1','[::1]'];
export type AccessConfig={remoteMode:boolean;publicOrigin?:string;publicHostname?:string;proxyToken?:string};

// Remote deployment is an explicit opt-in. A public media base alone never enables it.
export function createAccessConfig(options:{remoteMode:boolean;publicBaseUrl?:string;proxyToken?:string}):AccessConfig {
 if(!options.remoteMode)return {remoteMode:false};
 if(!options.proxyToken||options.proxyToken.trim().length<32||/[\r\n]/.test(options.proxyToken))throw new Error('远程模式要求至少 32 字符的 CREATOR_PROXY_TOKEN。');
 let url:URL;
 try{url=new URL(options.publicBaseUrl||'');}catch{throw new Error('远程模式要求有效的 PUBLIC_BASE_URL。');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('远程 PUBLIC_BASE_URL 必须为不包含凭证、查询参数或片段的 HTTP(S) 地址。');
 return {remoteMode:true,publicOrigin:url.origin,publicHostname:url.hostname,proxyToken:options.proxyToken};
}

export function accessMiddleware(config:AccessConfig){
 return (req:Request,res:Response,next:NextFunction)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const host=new URL(`http://${req.headers.host||''}`);
   const allowed=loopbackHosts.includes(host.hostname)||config.remoteMode&&host.hostname===config.publicHostname;
   if(!allowed||host.username||host.password||host.pathname!=='/'||host.search||host.hash)throw 0;
  }catch{res.status(403).json({error:config.remoteMode?'工作台拒绝未许可的 Host':'本地工作台拒绝非本机 Host'});return;}
  if(config.remoteMode){
   const supplied=req.headers['x-creator-proxy-token'];
   const expected=Buffer.from(config.proxyToken!);const actual=typeof supplied==='string'?Buffer.from(supplied):Buffer.alloc(0);
   if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.status(403).json({error:'工作台要求可信认证代理。'});return;}
  }
  const origin=req.headers.origin;
  if(origin){
   if(config.remoteMode){if(origin!==config.publicOrigin){res.status(403).json({error:'工作台拒绝跨站请求'});return;}}
   else{try{const url=new URL(origin);if(!loopbackHosts.includes(url.hostname)){res.status(403).json({error:'本地工作台拒绝跨站请求'});return;}}catch{res.status(403).json({error:'Origin 无效'});return;}}
  }
  next();
 };
}

export function validateBindHost(host:string,access:AccessConfig):void {
 if(['127.0.0.1','localhost','::1'].includes(host))return;
 if(access.remoteMode&&host==='0.0.0.0')return;
 throw new Error('工作台仅允许回环绑定；显式远程模式可在容器内绑定 0.0.0.0。');
}
