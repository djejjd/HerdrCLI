// 从当前终端已核验的会话查询 Magpie 路由，同时读取天生不触发厂商请求的缓存额度。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codexSessionQuery, modelRoute } from './model.js';

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
  const root = join(homedir(), '.codex');
  const state = pathToFileURL(join(root, 'state_5.sqlite')).href.replaceAll("'", "''");
  const sql = "ATTACH DATABASE '" + state + "?mode=ro' AS state; " + codexSessionQuery(pid, started);
  const {stdout} = await execute('sqlite3', ['-readonly', '-json', join(root, 'logs_2.sqlite'), sql], {timeout:1500});
  const records = JSON.parse(stdout || '[]');
  return records.length === 1 ? {...records[0],program:'codex'} : null;
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
    return modelRoute(model, resultRoute?.route);
  } catch { return null; }
}

const [quota, route] = await Promise.all([get('quotas?kept=1').catch(() => null), readRoute()]);
console.log(JSON.stringify({cards:Array.isArray(quota?.data) ? quota.data : null, route}));
