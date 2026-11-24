// 从当前终端已核验的会话查询 Magpie 路由，同时读取天生不触发厂商请求的缓存额度。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, open, readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundSession, codexSessionQuery, modelRoute } from './model.js';

import { familyCost, latestBillingKey } from './fee.js';

async function keyBalance(csv,session) {
  const usage=latestBillingKey(csv,session);
  if (!usage) return null;
  try {
    const config=JSON.parse(await readFile(join(homedir(),'.config/magpie/providers.json'),'utf8'));
    const provider=config.providers.find(item=>item.id===usage.provider);
    if (typeof provider?.key!=='string' || createHash('sha256').update(provider.key).digest('hex').slice(0,10)!==usage.id) return null;
    const quota=await get('quotas?kept=1');
    const matches=quota.data.filter(card=>card.kind==='balance' && card.provider===usage.provider && !card.user && !card.error && card.balance!=null);
    return matches.length===1 ? {balance:matches[0].balance,kind:'balance'} : null;
  } catch {return null;}
}

const execute = promisify(execFile);

const address = process.argv[2];
const base = new URL('http://127.0.0.1:3425/v1/magpie/');
async function get(path) {
  const response = await fetch(new URL(path, base), {signal:AbortSignal.timeout(2600), redirect:'error'});
  if (!response.ok) throw new Error('Magpie unavailable');
  return response.json();
}

async function ompModel(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const root = join(homedir(), '.omp', 'agent', 'sessions');
  const files = await readdir(root, {recursive:true});
  const match = files.filter(file => file.endsWith('_' + id + '.jsonl'));
  if (match.length !== 1) return null;
  const file = await open(join(root, match[0]));
  try {
    const size = (await file.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, 8 * 1024 * 1024));
    const {bytesRead} = await file.read(buffer, 0, buffer.length, size - buffer.length);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    for (const line of lines.reverse()) {
      if (!line.startsWith('{"type":"model_change"')) continue;
      try {
        const record = JSON.parse(line);
        if (record.type === 'model_change' && typeof record.model === 'string'
          && record.role !== 'small' && record.role !== 'smol') return record.model;
      } catch { /* 尾部可能仍在写入。 */ }
    }
    return null;
  } finally { await file.close(); }
}

async function codexIdentity() {
  const terminal = JSON.parse((await execute('hc', ['get', address], {timeout:1800})).stdout);
  if (terminal.state !== 'live' || terminal.foreground?.name !== 'codex') return null;
  const pid = terminal.foreground.pid;
  const start = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {timeout:1000});
  const started = Math.floor(Date.parse(start.stdout.trim()) / 1000);
  const current = boundSession(terminal,started);
  if (current && JSON.parse(terminal.labels['workbench.footer.binding']).source==='hook') return {sessionId:current,program:'codex'};
  const root = join(homedir(), '.codex');
  const state = pathToFileURL(join(root, 'state_5.sqlite')).href.replaceAll("'", "''");
  const sql = "ATTACH DATABASE '" + state + "?mode=ro' AS state; " + codexSessionQuery(pid, started);
  const {stdout} = await execute('sqlite3', ['-readonly', '-json', join(root, 'logs_2.sqlite'), sql], {timeout:1500});
  const records = JSON.parse(stdout || '[]');
  if (records.length === 1) return {...records[0],program:'codex'};
  const sessionId = records.length === 0 && boundSession(terminal, started);
  return sessionId ? {sessionId,program:'codex'} : null;
}

async function verifiedIdentity() {
  const native = await codexIdentity().catch(() => null);
  if (native) return native;
  const script = fileURLToPath(new URL('../agents-order/session.mjs', import.meta.url));
  const result = await execute(process.execPath, [script, 'verify', address], {timeout:4000});
  const identity = JSON.parse(result.stdout);
  return identity.ok ? identity : null;
}

async function readRoute() {
  if (!/^t[a-z0-9]+$/i.test(address ?? '')) return null;
  try {
    const identity = await verifiedIdentity();
    if (!identity?.sessionId) return null;
    const resultRoute = await get('route?' + new URLSearchParams({session:identity.sessionId})).catch(() => null);
    const model = identity.program === 'omp' ? await ompModel(identity.sessionId).catch(() => null) : identity.model;
    const route = modelRoute(model, resultRoute?.route);
    if (!route) return null;
    try {
      const {stdout} = await execute('magpie', ['usage','--csv','all'], {timeout:3500,maxBuffer:16*1024*1024});
      let children = [], partial = false;
      try {
        const listing = await execute('hc',['ls','--all','--json','--label','workbench.child.owner='+identity.sessionId],{timeout:1800});
        const managed = JSON.parse(listing.stdout).terminals;
        const results = await Promise.allSettled(managed.slice(0,32).map(async item => {
          const {stdout} = await execute('hc',['get',item.address],{timeout:1800});
          const child = JSON.parse(stdout);
          if (child.labels?.['workbench.child.owner'] !== identity.sessionId) return null;
          const pid = child.foreground?.pid ?? child.pid;
          const started = Math.floor(child.created_ms / 1000);
          const sql = codexSessionQuery(pid,started).replace('LIMIT 2;',Number.isFinite(child.finished_ms) ? `AND l.ts <= ${Math.ceil(child.finished_ms/1000)} LIMIT 2;` : 'LIMIT 2;');
          const state = pathToFileURL(join(homedir(),'.codex','state_5.sqlite')).href.replaceAll("'","''");
          const lookup = await execute('sqlite3',['-readonly','-json',join(homedir(),'.codex','logs_2.sqlite'),`ATTACH DATABASE '${state}?mode=ro' AS state; ${sql}`],{timeout:1500});
          const rows = JSON.parse(lookup.stdout || '[]');
          if (rows.length !== 1) return null;
          return {id:rows[0].sessionId,name:child.labels['workbench.name']};
        }));
        children = results.flatMap(result => result.value ? [result.value] : []);
        partial = children.length !== managed.length;
      } catch { partial = true; }
      if (identity.program === 'codex' && /^[a-f0-9-]{36}$/i.test(identity.sessionId)) {
        const query = `WITH RECURSIVE family(id) AS (SELECT '${identity.sessionId}' UNION SELECT child_thread_id FROM thread_spawn_edges JOIN family ON parent_thread_id=family.id) SELECT family.id,coalesce(agent_path,'子 Agent') AS name FROM family LEFT JOIN threads ON threads.id=family.id WHERE family.id<>'${identity.sessionId}'`;
        try {
          const result = await execute('sqlite3',['-readonly','-json',join(homedir(),'.codex','state_5.sqlite'),query],{timeout:1500});
          children.push(...JSON.parse(result.stdout || '[]'));
        } catch { partial = true; }
      }
      return {...route,sessionId:identity.sessionId,keyCard:await keyBalance(stdout,identity.sessionId),bill:{...familyCost(stdout,identity.sessionId,children),partial}};
    } catch { return {...route, cost:null}; }
  } catch { return null; }
}

const [quota, route] = await Promise.all([process.argv[3]==='fee' ? null : get('quotas?kept=1').catch(() => null), address==='quota' ? null : readRoute()]);
console.log(JSON.stringify({cards:Array.isArray(quota?.data) ? quota.data : null, route}));
