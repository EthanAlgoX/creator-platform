import {createApp} from './app.js';
const port=Number(process.env.PORT||4318);const host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('个人本地工作台只允许绑定回环地址。远程使用需要额外认证与部署设计。');
const instance=createApp();const server=instance.app.listen(port,host,()=>console.log(`Creator Platform: http://${host}:${port}`));
let shuttingDown=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(shuttingDown)return;shuttingDown=true;instance.queue.stop();server.close(()=>{instance.store.close();process.exit(0);});});
