// 额度解析：只用当前终端进程自己打开的会话文件，账号绑定在内存里比较，不输出凭据。
import { openSync, readSync, closeSync, statSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCodexQuota, sessionHome, matchAccount, pickFresh } from './quota.js';

const [program, pidArg] = process.argv.slice(2);
const out = (value) => { console.log(JSON.stringify(value)); process.exit(0); };
const unknown = (reason) => out({ status: 'unknown', reason });
const started = Date.now();

if (program !== 'codex') unknown('该 Agent 暂无账户额度数据源');
if (!/^\d+$/.test(pidArg ?? '')) unknown('缺少当前终端进程');

function openSessionFiles(pid) {
  let text = '';
  try {
    text = execFileSync('/usr/sbin/lsof', ['-Fn', '-p', pid], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 });
  } catch { return []; }
  return text.split('\n').filter(l => l.startsWith('n'))
    .map(l => l.slice(1))
    .filter(p => p.includes('/sessions/') && p.endsWith('.jsonl'));
}

function headMeta(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const line = buf.subarray(0, n).toString('utf8').split('\n')[0];
    const rec = JSON.parse(line);
    const p = rec?.payload ?? rec;
    return { session_id:p?.session_id ?? null, creator_account_id:p?.creator_account_id ?? null, model_provider:p?.model_provider ?? null };
  } catch { return null; } finally { closeSync(fd); }
}

function tailRateLimits(path) {
  const size = statSync(path).size;
  const start = Math.max(0, size - 512 * 1024);
  const length = size - start;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    const lines = buf.toString('utf8').split('\n');
    let scanned = 0;
    for (let i = lines.length - 1; i >= 0 && scanned < 2000; i--, scanned++) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let rec;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      const payload = rec?.payload;
      const rate = payload?.rate_limits ?? rec?.rate_limits;
      if (!rate) continue;
      const ts = Date.parse(rec?.timestamp ?? payload?.timestamp ?? '');
      return { rate, snapshotAt: Number.isFinite(ts) ? ts : null };
    }
    return null;
  } catch { return null; } finally { closeSync(fd); }
}

function configProvider(home) {
  const path = join(home, 'config.toml');
  try {
    const text = readFileSync(path, 'utf8');
    const m = text.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch { return null; }
}

try {
  const files = openSessionFiles(pidArg);
  if (!files.length) unknown('当前进程未持有会话文件');
  const homes = [...new Set(files.map(sessionHome).filter(Boolean))];
  if (homes.length !== 1) unknown('无法确定当前进程的 CODEX_HOME');
  const home = homes[0];
  const authPath = join(home, 'auth.json');
  if (!existsSync(authPath)) unknown('当前 CODEX_HOME 缺少登录信息');
  let accountId = null;
  try { accountId = JSON.parse(readFileSync(authPath, 'utf8'))?.tokens?.account_id ?? null; } catch { accountId = null; }
  if (!accountId) unknown('当前账号缺少可核对的非敏感账号 ID');

  const metas = files.map(path => ({ path, meta: headMeta(path) }));
  const matched = matchAccount(metas, accountId, configProvider(home));
  if (matched.status !== 'ok') unknown(matched.reason);

  // 只用同账号文件里的额度快照，取唯一最新且新鲜的。
  const candidates = matched.files
    .map(f => { const hit = tailRateLimits(f.path); return hit ? { ...hit, path: f.path } : null; })
    .filter(Boolean);
  const picked = pickFresh(candidates, Date.now(), 60 * 60 * 1000);
  if (picked.status !== 'ok') unknown(picked.reason);
  const quota = parseCodexQuota(picked.snapshot.rate, picked.snapshot.snapshotAt);
  out(quota);
} catch (err) {
  out({ status: 'error', reason: '额度读取失败' });
}
