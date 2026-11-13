// 独立数据目录内验证真实 OpenCode 插件身份事件，不发送模型请求。
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
const root=await mkdtemp(join(tmpdir(),'herdr-opencode-'));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port;await new Promise(r=>listener.close(r));
const start=()=>spawn('opencode',['serve','--hostname','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe'],env:{...process.env,XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),HERDR_WORKBENCH_IDENTITY_HOME:join(root,'identity'),OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_CONFIG_CONTENT:JSON.stringify({plugin:[pathToFileURL(resolve('mods/agent-workbench/opencode-plugin.mjs')).href]})}});
let child=start();
const quiet=()=>{child.stdout.resume();child.stderr.resume();};quiet();
const stop=async()=>{if(child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;};
const request=async(path,data)=>{
 const r=await fetch(`http://127.0.0.1:${port}`+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(path==='/global/health'?2000:20000)});
 if(!r.ok)throw new Error(`HTTP ${r.status} at ${path}`);return r.json();
};
try {
 let ready=false;for(let i=0;i<100&&!ready;i++){try{await request('/global/health');ready=true;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!ready)throw new Error('server startup failed');
 console.log('Server ready; creating isolated session');
 const session=await request('/session',{title:'工作台身份测试'});
 if(!session.id?.startsWith('ses_'))throw new Error('session creation failed');
 console.log('Session created; checking selection event');
 await request('/tui/select-session',{sessionID:session.id});
 let record;for(let i=0;i<30&&!record;i++){try{record=JSON.parse(await readFile(join(root,'identity',child.pid+'.json'),'utf8'));}catch{await new Promise(r=>setTimeout(r,100));}}
 if(record?.sessionId!==session.id)throw new Error('identity event did not reach plugin');
 console.log('Identity matched; restarting isolated engine');
 await stop();child=start();quiet();
 let restarted=false;for(let i=0;i<100&&!restarted;i++){try{await request('/global/health');restarted=true;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!restarted)throw new Error('engine restart failed');
 const restored=await request('/session/'+session.id);if(restored.id!==session.id)throw new Error('persisted session not restored');
 await request('/tui/select-session',{sessionID:session.id});
 record=null;for(let i=0;i<30&&!record;i++){try{record=JSON.parse(await readFile(join(root,'identity',child.pid+'.json'),'utf8'));}catch{await new Promise(r=>setTimeout(r,100));}}
 if(record?.sessionId!==session.id)throw new Error('restored identity mismatch');
 console.log('PASS: real OpenCode engine restart preserves exact session; selection identity matches new PID; no model request');
}catch(e){console.error('FAIL:',e.message);process.exitCode=1;}
finally{await stop();await rm(root,{recursive:true,force:true});}
