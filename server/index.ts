import {createApp} from './app.js';
import {createAccessConfig,validateBindHost} from './access.js';
const port=Number(process.env.PORT||4318);const host=process.env.HOST||'127.0.0.1';
const access=createAccessConfig({remoteMode:process.env.CREATOR_REMOTE_MODE==='1',publicBaseUrl:process.env.PUBLIC_BASE_URL,proxyToken:process.env.CREATOR_PROXY_TOKEN});validateBindHost(host,access);
const instance=createApp();const server=instance.app.listen(port,host,()=>console.log(`Creator Platform: http://${host}:${port}`));
let shuttingDown=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(shuttingDown)return;shuttingDown=true;instance.queue.stop();server.close(()=>{instance.store.close();process.exit(0);});});
