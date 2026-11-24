import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

let stage='entry';
function diagnostic() {
  try {writeFileSync(join(homedir(),'.codex','herdr-binding-stage.json'),JSON.stringify({stage,time:Date.now()}),{mode:0o600});} catch {}
}

export function eventBinding(event,terminal,owner,started) {
  if (!['SessionStart','UserPromptSubmit'].includes(event.hook_event_name) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event.session_id)) return null;
  if (terminal.state!=='live' || terminal.foreground?.name!=='codex' || owner!==terminal.foreground.pid || !Number.isSafeInteger(started)) return null;
  return {address:terminal.address,created_ms:terminal.created_ms,pid:owner,started,sessionId:event.session_id,source:'hook'};
}

function command(program,args) {
  return execFileSync(program==='hc'?join(homedir(),'.local/bin/hc'):program,args,{encoding:'utf8',timeout:1500,stdio:['ignore','pipe','ignore']});
}

function codexAncestor() {
  let pid=process.ppid;
  for (let depth=0;depth<12 && pid>1;depth++) {
    const match=command('/bin/ps',['-p',String(pid),'-o','ppid=,comm=']).trim().match(/^(\d+)\s+(.+)$/);
    if (!match) break;
    if (match[2].split('/').at(-1)==='codex') return pid;
    pid=Number(match[1]);
  }
  return null;
}

async function run() {
  const address=process.env.HC_TERMINAL_ID;
  stage='terminal-environment';
  let input='';
  for await (const chunk of process.stdin) { input+=chunk; if(input.length>1048576) return; }
  const event=JSON.parse(input);
  stage='owner';
  const owner=codexAncestor();
  if (!owner || (process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID!==event.session_id)) return;
  stage='terminal-read';
  const addresses=/^t[a-z0-9]+$/.test(address ?? '') ? [address] : JSON.parse(command('hc',['ls','--json'])).terminals.filter(item=>item.state==='live' && /^t[a-z0-9]+$/.test(item.address)).map(item=>item.address);
  const matches=addresses.map(id=>JSON.parse(command('hc',['get',id]))).filter(item=>item.foreground?.pid===owner);
  if(matches.length!==1) return;
  const terminal=matches[0];
  const started=Math.floor(Date.parse(command('/bin/ps',['-p',String(owner),'-o','lstart=']).trim())/1000);
  const binding=eventBinding(event,terminal,owner,started);
  stage=binding?'write':'foreground';
  if (binding && terminal.labels?.['workbench.footer.binding']!==JSON.stringify(binding)) command('hc',['label',terminal.address,'workbench.footer.binding='+JSON.stringify(binding)]);
  if (binding) stage='bound';
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await run().catch(()=>{}).finally(diagnostic);
