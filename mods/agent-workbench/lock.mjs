// 原子目录锁协调同一配置目录内多个窗口的恢复操作；终态必须释放。
import { mkdir, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [action,id]=process.argv.slice(2);
if(!id||!['acquire','release'].includes(action))process.exit(1);
const root=process.env.HERDR_WORKBENCH_LOCK_HOME??join(dirname(fileURLToPath(import.meta.url)),'../../data/workbench-locks');
const path=join(root,Buffer.from(id).toString('hex'));
await mkdir(root,{recursive:true});
try {if(action==='acquire')await mkdir(path);else await rmdir(path);console.log('ok');}
catch{process.exitCode=1;}
