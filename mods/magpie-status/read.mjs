// 从当前终端已核验的会话查询 Magpie 路由，同时读取天生不触发厂商请求的缓存额度。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function readRoute() {
  if (!/^t[a-z0-9]+$/i.test(address ?? '')) return null;
  const script = fileURLToPath(new URL('../agents-order/session.mjs', import.meta.url));
  try {
    const result = await promisify(execFile)(process.execPath, [script, 'verify', address], {timeout:5000});
    const identity = JSON.parse(result.stdout);
    if (!identity.ok || !identity.sessionId) return null;
    const resultRoute = await get('route?' + new URLSearchParams({session:identity.sessionId})).catch(() => null);
    const route = resultRoute?.route;
    if (!route) {
      const model = identity.program === 'omp' ? await ompModel(identity.sessionId) : null;
      return model ? {model, provider:null, account:null} : null;
    }
    const target = typeof route.model === 'string' ? route.model : '';
    const slash = target.indexOf('/');
    return {model:slash >= 0 ? target.slice(slash + 1) : target || route.asked,
      provider:slash >= 0 ? target.slice(0, slash) : null,
      account:typeof route.served?.account === 'string' ? route.served.account : null};
  } catch { return null; }
}

const [quota, route] = await Promise.all([get('quotas?kept=1').catch(() => null), readRoute()]);
console.log(JSON.stringify({cards:Array.isArray(quota?.data) ? quota.data : null, route}));
