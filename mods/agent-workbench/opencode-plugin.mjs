// 只记录 hook 给出的会话身份，不访问消息参数或对话正文。
import { mkdir,writeFile,rename } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export const WorkbenchIdentity=async()=>{
  const root=process.env.HERDR_WORKBENCH_IDENTITY_HOME??join(dirname(fileURLToPath(import.meta.url)),'../../data/workbench-opencode');
  const started=execFileSync('/bin/ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim();
  let pending=Promise.resolve();
  const save=async sessionId=>{
    if(!/^ses_[a-zA-Z0-9]+$/.test(sessionId??''))return;
    try {
      await mkdir(root,{recursive:true});
      const path=join(root,process.pid+'.json'),temp=path+'.tmp';
      await writeFile(temp,JSON.stringify({pid:process.pid,started,sessionId}),{mode:0o600});await rename(temp,path);
    }catch{ /* 不影响 Agent；身份缺失由恢复界面说明。 */ }
  };
  return {
    'chat.message':async input=>{pending=pending.then(()=>save(input.sessionID));await pending;},
    event:async({event})=>{if(event.type==='tui.session.select'){pending=pending.then(()=>save(event.properties?.sessionID));await pending;}},
  };
};
