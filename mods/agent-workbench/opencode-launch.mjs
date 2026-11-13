// 当前工作台专用启动器：仅在本次进程注入身份插件，保留用户原有配置。
import { spawn } from 'node:child_process';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
let config;
try{config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT??'{}');}
catch{console.error('OpenCode 配置无效，未启动工作台适配器');process.exit(1);}
const plugin=pathToFileURL(join(dirname(fileURLToPath(import.meta.url)),'opencode-plugin.mjs')).href;
config.plugin=[...new Set([...(config.plugin??[]),plugin])];
const child=spawn('opencode',process.argv.slice(2),{stdio:'inherit',env:{...process.env,OPENCODE_CONFIG_CONTENT:JSON.stringify(config)}});
child.on('error',()=>{console.error('无法启动 OpenCode，请检查安装状态');process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
