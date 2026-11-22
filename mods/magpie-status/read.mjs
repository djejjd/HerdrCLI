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

// 进程间摘要只传代码内定义的阶段与原因，外部错误正文留在读取进程内。
class ReadFailure extends Error {}

async function attempt(failures, stage, read) {
  try {
    return await read();
  } catch (error) {
    const reason = error instanceof ReadFailure ? error.message
      : error?.name === 'TimeoutError' || (error?.killed && error.signal === 'SIGTERM')
        ? 'timeout' : 'unavailable';
    failures.push({stage, reason});
    return null;
  }
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new ReadFailure('invalid-response');
  }
}

async function get(path, missingIsExpected = false) {
  const response = await fetch(new URL(path, base), {signal:AbortSignal.timeout(2600), redirect:'error'});
  if (missingIsExpected && response.status === 404) throw new ReadFailure('not-found');
  if (!response.ok) throw new ReadFailure('http-error');
  return parseJson(await response.text());
}

async function readQuotas() {
  const result = await get('quotas?kept=1');
  if (!Array.isArray(result?.data)) throw new ReadFailure('invalid-response');
  return result.data;
}

async function recentRoute(sessionId) {
  const result = await get('route?' + new URLSearchParams({session:sessionId}), true);
  if (!result || !Object.hasOwn(result, 'route')) throw new ReadFailure('invalid-response');
  if (result.route === null) throw new ReadFailure('not-found');
  if (typeof result.route !== 'object' || Array.isArray(result.route)) throw new ReadFailure('invalid-response');
  return result.route;
}

async function ompModel(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ReadFailure('invalid-response');
  const root = join(homedir(), '.omp', 'agent', 'sessions');
  const files = await readdir(root, {recursive:true});
  const match = files.filter(file => file.endsWith('_' + id + '.jsonl'));
  if (match.length !== 1) throw new ReadFailure('not-found');
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
    throw new ReadFailure('not-found');
  } finally { await file.close(); }
}

async function codexIdentity(failures) {
  const terminal = await attempt(failures, 'terminal', async () => {
    const result = parseJson((await execute('hc', ['get', address], {timeout:1800})).stdout);
    if (!result || typeof result.state !== 'string') throw new ReadFailure('invalid-response');
    return result;
  });
  if (terminal?.state !== 'live' || terminal.foreground?.name !== 'codex') return null;
  const pid = terminal.foreground.pid;
  const started = await attempt(failures, 'codex-process', async () => {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new ReadFailure('invalid-response');
    const start = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {timeout:1000});
    const seconds = Math.floor(Date.parse(start.stdout.trim()) / 1000);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new ReadFailure('invalid-response');
    return seconds;
  });
  if (!started) return null;
  return attempt(failures, 'codex-session', () => codexSession(pid, started));
}

async function codexSession(pid, started) {
  const root = join(homedir(), '.codex');
  const state = pathToFileURL(join(root, 'state_5.sqlite')).href.replaceAll("'", "''");
  const sql = "ATTACH DATABASE '" + state + "?mode=ro' AS state; " + codexSessionQuery(pid, started);
  const {stdout} = await execute('sqlite3', ['-readonly', '-json', join(root, 'logs_2.sqlite'), sql], {timeout:1500});
  const records = parseJson(stdout || '[]');
  if (!Array.isArray(records)) throw new ReadFailure('invalid-response');
  if (records.length !== 1) throw new ReadFailure('not-found');
  if (typeof records[0]?.sessionId !== 'string' || !records[0].sessionId) throw new ReadFailure('invalid-response');
  return {...records[0],program:'codex'};
}

async function fallbackIdentity() {
  const script = fileURLToPath(new URL('../agents-order/session.mjs', import.meta.url));
  let result;
  try {
    result = await execute(process.execPath, [script, 'verify', address], {timeout:4000});
  } catch (error) {
    // verifier 用退出码 1 表达身份未确认，只有带有效响应时才读取其状态。
    if (error.code !== 1 || !error.stdout) throw error;
    result = error;
  }
  const identity = parseJson(result.stdout);
  if (identity?.ok === false) {
    const reason = identity.reason;
    throw new ReadFailure(typeof reason === 'string' && reason.startsWith('verify-error:') ? 'unavailable' : 'not-found');
  }
  if (result.code === 1 || identity?.ok !== true || typeof identity.sessionId !== 'string' || !identity.sessionId) {
    throw new ReadFailure('invalid-response');
  }
  return identity;
}

async function readRoute(failures) {
  if (!/^t[a-z0-9]+$/i.test(address ?? '')) return null;
  const identityFailures = [];
  const identity = await codexIdentity(identityFailures)
    ?? await attempt(identityFailures, 'session', fallbackIdentity);
  if (!identity) {
    failures.push(...identityFailures);
    return null;
  }
  const route = await attempt(failures, 'route', () => recentRoute(identity.sessionId));
  const model = identity.program === 'omp'
    ? await attempt(failures, 'omp-model', () => ompModel(identity.sessionId)) : identity.model;
  return modelRoute(model, route);
}

const quotaFailures = [];
const routeFailures = [];
const [cards, route] = await Promise.all([
  attempt(quotaFailures, 'quota', readQuotas),
  readRoute(routeFailures),
]);
console.log(JSON.stringify({cards, route, failures:[...quotaFailures, ...routeFailures]}));
