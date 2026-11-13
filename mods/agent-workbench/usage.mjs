// 会话费用估算：显式会话 ID + 增量/限额解析；未知不返回 0，cache 只存用量元数据。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { newCodexState, feedCodex, summarizeCodex, cacheInvalid, consumedBytes, claudeUsage, cumulativeOk, matchSessionFile, totals, cacheFresh } from './usage.js';
import { createHash } from 'node:crypto';
import { matchPricing, recordCost, resolveAlias } from './pricing.js';
import { PRICE_TABLE } from './price-table.js';
import { readZstd } from './zstd-reader.js';
import { convertToCny, localDayKey, resolveFxRate } from './fx.js';

const [program, id, sessionId] = process.argv.slice(2);
const out = (v) => { console.log(JSON.stringify(v)); process.exit(0); };
const unknown = (reason, extra = {}) => out({ status:'unknown', reason, reasons:[reason], ...extra });
const DATA = join(homedir(), '.config/herdr-app/data');
const FX_CACHE = join(DATA, 'fx-cny.json');
const MAX_ZSTD_BYTES = 32 * 1024 * 1024, MAX_RECORDS = 50000;
const BUDGET_MS = 6000, STARTED = Date.now();
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function writeJson(path, value) { try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); } catch {} }
const remaining = () => Math.max(0, BUDGET_MS - (Date.now() - STARTED));

// App 的 exec 环境可能没有代理变量；回退到系统代理 + curl。
function systemProxy() {
  try {
    if (process.platform !== 'darwin') return null;
    const out = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding:'utf8', timeout:600 });
    const v = (k) => out.match(new RegExp(`${k}\\s*:\\s*(\\S+)`))?.[1] ?? null;
    if (v('HTTPSEnable') === '1' && v('HTTPSProxy') && v('HTTPSPort')) return `http://${v('HTTPSProxy')}:${v('HTTPSPort')}`;
    if (v('HTTPEnable') === '1' && v('HTTPProxy') && v('HTTPPort')) return `http://${v('HTTPProxy')}:${v('HTTPPort')}`;
  } catch {}
  return null;
}
async function fxRate() {
  const url = 'https://api.frankfurter.app/latest?from=USD&to=CNY';
  const now = new Date();
  let cache = null;
  try { cache = JSON.parse(readFileSync(FX_CACHE, 'utf8')); } catch {}
  const hit = await resolveFxRate({
    cache, now,
    fetchJson: async () => {
      if (remaining() < 400) throw new Error('budget');
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(1500, remaining())) });
      const d = await res.json();
      return { rate:d?.rates?.CNY, quoteDate:d?.date, source:'ECB/frankfurter' };
    },
    curlJson: async () => {
      const t = Math.min(2500, remaining());
      if (t < 400) throw new Error('budget');
      const proxy = systemProxy();
      const sec = Math.max(1, Math.floor(t / 1000));
      const args = ['-sL', '--max-time', String(sec), ...(proxy ? ['-x', proxy] : []), url];
      const out = execFileSync('/usr/bin/curl', args, { encoding:'utf8', timeout:t });
      const d = JSON.parse(out);
      return { rate:d?.rates?.CNY, quoteDate:d?.date, source:'ECB/frankfurter(curl)' };
    },
  });
  if (hit && hit.date === localDayKey(now) && !hit.stale) {
    try { mkdirSync(DATA, { recursive: true }); writeFileSync(FX_CACHE, JSON.stringify(hit)); } catch {}
  }
  return hit;
}

function openSessionFiles(pid) {
  try {
    const text = execFileSync('/usr/sbin/lsof', ['-Fn', '-p', pid], { encoding:'utf8', timeout:2000, maxBuffer:1024*1024 });
    return text.split('\n').filter(l => l.startsWith('n')).map(l => l.slice(1))
      .filter(p => p.includes('/sessions/') && p.endsWith('.jsonl'));
  } catch { return []; }
}
function headMeta(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const rec = JSON.parse(buf.subarray(0, n).toString('utf8').split('\n')[0]);
    const p = rec?.payload ?? rec;
    return { provider: p?.model_provider ?? null };
  } catch { return null; } finally { closeSync(fd); }
}

async function codexCost() {
  if (!sessionId) return unknown('缺少明确会话 ID，无法证明当前对话归属');
  const files = matchSessionFile(openSessionFiles(id), sessionId);
  if (files.length !== 1) return unknown(files.length ? '会话文件不唯一，无法证明归属' : '未找到该会话文件');
  if (remaining() < 800) return unknown('时间预算不足，无法解析会话');
  const file = files[0], st = statSync(file);
  const meta = headMeta(file);
  const cachePath = join(DATA, `usage-codex-${sessionId}.json`);
  let cache = readJson(cachePath);
  if (cacheInvalid(cache, file, st)) {
    cache = { version:1, path:file, inode:st.ino, offset:0, state:newCodexState() };
  }
  if (st.size > cache.offset) {
    const len = Math.min(st.size - cache.offset, 64 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, len, cache.offset); } finally { closeSync(fd); }
    const text = buf.toString('utf8');
    const nl = text.lastIndexOf('\n');
    if (nl >= 0) {
      const complete = text.slice(0, nl);
      const events = complete.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      feedCodex(cache.state, events);
      cache.offset = consumedBytes(cache.offset, text) ?? cache.offset;
      writeJson(cachePath, cache);
    }
  }
  const parsed = summarizeCodex(cache.state);
  if (!parsed.segments.length) return unknown('该会话没有可用请求级用量');
  const entry = matchPricing(parsed.model, meta?.provider, PRICE_TABLE);
  if (!entry) return unknown(`未知模型或无官方价：${parsed.model ?? 'unknown'}`);
  const costs = parsed.segments.map(s => recordCost({ model:parsed.model, provider:meta?.provider, input:s.input, output:s.output, cacheWrite:s.cacheWrite, cacheRead:s.cacheRead, at:s.at }, entry, s.at));
  if (costs.some(c => c.status !== 'ok')) return unknown('部分请求缺价格字段，无法完整估算');
  const amount = costs.reduce((a, c) => a + c.amount, 0);
  const hi = costs.reduce((a, c) => a + (c.range ? c.range[1] : c.amount), 0);
  const partial = !parsed.complete || costs.some(c => c.partial);
  const fx = await fxRate();
  const conv = convertToCny(amount, 'USD', fx, new Date());
  if (conv.status !== 'ok') return unknown(conv.reason ?? '汇率不可用');
  const convHi = convertToCny(hi, 'USD', fx, new Date());
  return {
    status: partial ? 'partial' : 'ready', cny: conv.amount,
    rangeCny: partial && hi > amount ? [conv.amount, convHi.amount] : undefined,
    original:{ amount, currency:'USD' }, fx: conv.fx,
    coverage:{ from: parsed.segments[0].at ? new Date(parsed.segments[0].at).toISOString() : null, complete: parsed.complete },
    requests: parsed.segments.length,
    models:[{ model:parsed.model, provider:meta?.provider ?? null, currency:'USD', amount, requests:parsed.segments.length }],
    reasons: [...parsed.reasons, ...(costs.some(c => c.partial) ? ['缓存写 TTL 未知，金额为区间下限'] : [])],
    priceSource: entry.source, priceFetchedAt: entry.fetchedAt,
  };
}

async function dshCost() {
  if (!sessionId) return unknown('缺少明确会话 ID，无法证明当前对话归属');
  const path = (() => {
    if (process.env.HERDR_USAGE_SNAPSHOT) return existsSync(process.env.HERDR_USAGE_SNAPSHOT) ? process.env.HERDR_USAGE_SNAPSHOT : null;
    const roots = [join(homedir(), '.dsh/sessions')];
    const hits = [];
    for (const root of roots) {
      try { for (const proj of readdirSync(root)) { const p = join(root, proj, sessionId, 'session.v4.jsonl.zstd'); if (existsSync(p)) hits.push(p); } } catch {}
    }
    return hits.length === 1 ? hits[0] : null;
  })();
  if (!path) return unknown('未找到该会话的原始记录或存在多份');
  const st = statSync(path);
  const cachePath = join(DATA, `usage-dsh-${sessionId}.json`);
  let cache = readJson(cachePath);
  if (!cache || cache.version !== 1 || cache.path !== path || cache.size !== st.size || cache.mtime !== st.mtimeMs) {
    if (remaining() < 800) return unknown('时间预算不足，无法解析会话');
    const { text, truncated } = await readZstd(path, { spawn, caps:{ timeoutMs: Math.min(3000, remaining()) } });
    const records = [];
    let model = null, provider = null;
    let recordsSeen = 0;
    for (const line of text.split('\n')) {
      if (++recordsSeen > MAX_RECORDS) break;
      let d; try { d = JSON.parse(line); } catch { continue; }
      const data = d?.data;
      if (d?.type === 'assistant/message' && data && typeof data.usage === 'object') {
        if (model === null && typeof data.model === 'string') model = data.model;
        if (provider === null && typeof data.provider === 'string') provider = data.provider;
        const u = data.usage;
        const input = u.inputTokens, output = u.outputTokens, cacheRead = u.cacheReadTokens ?? 0, cacheWrite = u.cacheWriteTokens ?? 0;
        if (![input, output, cacheRead, cacheWrite].every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0)) continue;
        if (typeof u.totalTokens === 'number' && u.totalTokens !== input + output + cacheRead + cacheWrite) continue; // 桶不自洽
        const at = typeof d.time === 'number' ? d.time : (Date.parse(d.time ?? '') || null);
        records.push({ seq:d.seq ?? null, at, input, output, cacheRead, cacheWrite });
      }
      if (typeof d?.data?.model === 'string') model = model ?? d.data.model;
      if (typeof d?.data?.provider === 'string') provider = provider ?? d.data.provider;
    }
    const seen = new Set(), unique = [];
    for (const r of records) { const k = r.seq ?? `${r.at}:${r.input}:${r.output}:${r.cacheRead}:${r.cacheWrite}`; if (seen.has(k)) continue; seen.add(k); unique.push(r); }
    cache = { version:1, path, size:st.size, mtime:st.mtimeMs, truncated, model, provider, records:unique };
    writeJson(cachePath, cache);
  }
  if (!cache.records.length) return unknown('该会话没有可用请求级用量');
  const entry = matchPricing(cache.model ?? 'deepseek-flash', cache.provider ?? 'deepseek-official', PRICE_TABLE);
  if (!entry) return unknown(`未知模型或无官方价：${cache.model ?? 'unknown'}`);
  const costs = cache.records.map(r => recordCost({ model:cache.model, provider:cache.provider, input:r.input, output:r.output, cacheWrite:r.cacheWrite, cacheRead:r.cacheRead, at:r.at }, entry, r.at));
  if (costs.some(c => c.status !== 'ok')) return unknown('部分请求缺价格字段，无法完整估算');
  const amount = costs.reduce((a, c) => a + c.amount, 0);
  const first = cache.records[0], last = cache.records[cache.records.length - 1];
  const fx = await fxRate();
  const conv = convertToCny(amount, 'USD', fx, new Date());
  if (conv.status !== 'ok') return unknown(conv.reason ?? '汇率不可用');
  return {
    status: cache.truncated ? 'partial' : 'ready', cny: conv.amount,
    original:{ amount, currency:'USD' }, fx: conv.fx,
    coverage:{ from: first.at ? new Date(first.at).toISOString() : null, to: last.at ? new Date(last.at).toISOString() : null, complete: !cache.truncated },
    requests: cache.records.length,
    models:[{ model:cache.model ?? 'deepseek-flash', provider:cache.provider ?? 'deepseek-official', currency:'USD', amount, requests:cache.records.length }],
    reasons: cache.truncated ? ['解压/记录数超限，仅统计已读取区间'] : [],
    priceSource: entry.source, priceFetchedAt: entry.fetchedAt,
  };
}

async function claudeCost() {
  if (!sessionId) return unknown('缺少明确会话 ID，无法证明当前对话归属');
  const hits = [];
  try { for (const d of readdirSync(join(homedir(), '.claude/projects'))) { const p = join(homedir(), '.claude/projects', d, `${sessionId}.jsonl`); if (existsSync(p)) hits.push(p); } } catch {}
  if (hits.length !== 1) return unknown(hits.length ? '会话文件不唯一' : '未找到该会话文件');
  // provider 由 Claude 配置的 baseURL 证实；只有官方 DeepSeek 域名才套 DeepSeek 官方价。
  let base = null;
  try { base = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'))?.env?.ANTHROPIC_BASE_URL ?? null; } catch {}
  let host = null;
  try { host = base ? new URL(base).host : null; } catch {}
  if (host !== 'api.deepseek.com') return unknown(`provider 无法证实（baseURL：${host ?? '缺失'}）`);
  const provider = 'deepseek-official';
  const records = [], seen = new Set();
  let bytes = 0, count = 0;
  const rl = createInterface({ input: createReadStream(hits[0]), crlfDelay: Infinity });
  for await (const line of rl) {
    if (++count > MAX_RECORDS || (bytes += line.length) > 64 * 1024 * 1024) break;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e?.type !== 'assistant' || !e.message) continue;
    const key = e.message.uuid ?? e.uuid ?? null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const rec = claudeUsage(e.message, Date.parse(e.timestamp ?? '') || null);
    if (rec) { rec.model = resolveAlias(rec.model); records.push(rec); }
  }
  if (!records.length) return unknown('该会话没有可用请求级用量');
  const entry = matchPricing(records[0].model, provider, PRICE_TABLE);
  if (!entry) return unknown(`未知模型或无官方价：${records[0].model ?? 'unknown'}`);
  const costs = records.map(r => recordCost({ model:r.model, provider, input:r.input, output:r.output, cacheWrite:r.cacheWrite, cacheRead:r.cacheRead, at:r.at }, entry, r.at));
  if (costs.some(c => c.status !== 'ok')) return unknown('部分请求缺价格字段，无法完整估算');
  const amount = costs.reduce((a, c) => a + c.amount, 0);
  const fx = await fxRate();
  const conv = convertToCny(amount, 'USD', fx, new Date());
  if (conv.status !== 'ok') return unknown(conv.reason ?? '汇率不可用');
  return {
    status:'partial', cny:conv.amount, original:{ amount, currency:'USD' }, fx:conv.fx,
    coverage:{ from: records[0].at ? new Date(records[0].at).toISOString() : null, complete:true },
    requests: records.length,
    models:[{ model:records[0].model, provider, currency:'USD', amount, requests:records.length }],
    reasons:['按当前 baseURL/配置参考估算，历史会话来源未单独证实','官方说明：deepseek-v4-flash 系列按 deepseek-flash 价计费'],
    priceSource: entry.source, priceFetchedAt: entry.fetchedAt,
  };
}

const TOTALS_TTL = 30_000;
const sha1 = (v) => createHash('sha1').update(String(v)).digest('hex').slice(0, 16);
function safeList(dir) { try { return readdirSync(dir); } catch { return []; } }
function totalsCacheFile(sessionId) { return join(DATA, `usage-totals-${sha1(sessionId)}.json`); }
function fileCache(kind, key) { return join(DATA, `usage-totals-${kind}-${sha1(key)}.json`); }

function dshFiles(weekStart) {
  const root = join(homedir(), '.dsh/sessions');
  const out = [];
  for (const proj of safeList(root)) {
    for (const sid of safeList(join(root, proj))) {
      const p = join(root, proj, sid, 'session.v4.jsonl.zstd');
      if (!existsSync(p)) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs < weekStart - 12 * 3600e3) continue;
      out.push({ path:p, sid, st });
    }
  }
  return out.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).slice(0, 40);
}

async function dshTotalsRecords(fx, weekStart) {
  const entry = matchPricing('deepseek-flash', 'deepseek-official', PRICE_TABLE);
  const records = [], notes = [];
  let files = 0;
  for (const f of dshFiles(weekStart)) {
    if (remaining() < 900) { notes.push('时间预算不足，DSH 未扫完'); break; }
    const cachePath = fileCache('dsh', f.path);
    const cached = readJson(cachePath);
    let rows = null;
    if (cached?.v === 3 && cached?.size === f.st.size && cached?.mtime === f.st.mtimeMs) rows = cached.rows;
    if (!rows) {
      const { text, truncated } = await readZstd(f.path, { spawn, caps:{ timeoutMs: Math.min(1200, remaining()) } });
      const msgs = [], models = new Set();
      for (const line of text.split('\n')) {
        let d; try { d = JSON.parse(line); } catch { continue; }
        const data = d?.data;
        if (typeof data?.model === 'string') models.add(data.model);
        if (d?.type !== 'assistant/message' || !data?.usage) continue;
        msgs.push({ usage:data.usage, at: typeof d.time === 'number' ? d.time : (Date.parse(d.time ?? '') || null), model: typeof data.model === 'string' ? data.model : null });
      }
      const sessionModel = models.size === 1 ? [...models][0] : null;
      rows = [];
      for (const m of msgs) {
        const model = m.model ?? sessionModel;
        if (model !== 'deepseek-flash' || !m.at) continue;
        const u = m.usage;
        const input = u.inputTokens, output = u.outputTokens, cacheRead = u.cacheReadTokens ?? 0, cacheWrite = u.cacheWriteTokens ?? 0;
        if (![input, output, cacheRead, cacheWrite].every(v => Number.isInteger(v) && v >= 0)) continue;
        if (typeof u.totalTokens === 'number' && u.totalTokens !== input + output + cacheRead + cacheWrite) continue;
        const c = recordCost({ model, provider:'deepseek-official', input, output, cacheWrite, cacheRead, at:m.at }, entry, m.at);
        if (c.status !== 'ok') continue;
        rows.push({ at:m.at, usd:c.amount, session:f.sid });
      }
      if (models.size > 1 || (models.size === 1 && sessionModel !== 'deepseek-flash')) notes.push('DSH 存在非 deepseek-flash 或模型不唯一的会话，未计入');
      writeJson(cachePath, { v:3, size:f.st.size, mtime:f.st.mtimeMs, rows });
      if (truncated) notes.push('DSH 部分会话解压受限');
    }
    files++;
    for (const r of rows) records.push({ at:r.at, cny:r.usd * fx.rate, session:r.session, source:'dsh' });
  }
  return { records, notes, files, total:dshFiles(weekStart).length };
}

function codexFiles(weekStart, sessionId = null) {
  const root = join(homedir(), '.codex/sessions');
  const out = [];
  const walk = (dir, depth) => {
    for (const name of safeList(dir)) {
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      if (!name.endsWith('.jsonl') || st.mtimeMs < weekStart - 2 * 864e5) continue;
      out.push({ path:p, st });
    }
  };
  walk(root, 0);
  out.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  // 当前会话必须纳入，不能被最近文件数上限挤掉。
  const head = sessionId ? out.filter(f => f.path.includes(sessionId)) : [];
  const rest = out.filter(f => !head.includes(f));
  return [...head, ...rest].slice(0, 12);
}

async function codexTotalsRecords(fx, weekStart) {
  const records = [], notes = [];
  let files = 0;
  for (const f of codexFiles(weekStart, sessionId)) {
    if (remaining() < 900) { notes.push('时间预算不足，Codex 未扫完'); break; }
    const sid = (f.path.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i)?.[1]) ?? null;
    const meta = headMeta(f.path);
    const cachePath = fileCache('codex', f.path);
    const cached = readJson(cachePath);
    let rows = null;
    if (cached?.v === 2 && cached?.size === f.st.size && cached?.mtime === f.st.mtimeMs) rows = cached.rows;
    if (!rows) {
      rows = [];
      const st = newCodexState();
      const rl = createInterface({ input: createReadStream(f.path), crlfDelay: Infinity });
      for await (const line of rl) {
        if (remaining() < 600) { notes.push('Codex 解析超预算，覆盖不完整'); break; }
        let e; try { e = JSON.parse(line); } catch { continue; }
        feedCodex(st, [e]);
      }
      const parsed = summarizeCodex(st);
      const entry = matchPricing(parsed.model, meta?.provider ?? 'openai', PRICE_TABLE);
      if (!entry) { notes.push(`Codex 模型缺官方价：${parsed.model ?? 'unknown'}`); continue; }
      for (const s of parsed.segments) {
        if (!s.at) continue;
        const c = recordCost({ model:parsed.model ?? 'gpt-6.1-sol', provider:meta?.provider ?? 'openai', input:s.input, output:s.output, cacheWrite:s.cacheWrite, cacheRead:s.cacheRead, at:s.at }, entry, s.at);
        if (c.status !== 'ok') continue;
        rows.push({ at:s.at, usd:c.amount, session:sid });
      }
      writeJson(cachePath, { v:2, size:f.st.size, mtime:f.st.mtimeMs, rows });
    }
    files++;
    for (const r of rows) records.push({ at:r.at, cny:r.usd * fx.rate, session:r.session, source:'codex' });
  }
  return { records, notes, files, total:codexFiles(weekStart).length };
}

function claudeProvider() {
  try {
    const base = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8'))?.env?.ANTHROPIC_BASE_URL ?? null;
    return base && new URL(base).host === 'api.deepseek.com' ? 'deepseek-official' : null;
  } catch { return null; }
}

function claudeFiles(weekStart, sessionId = null) {
  const root = join(homedir(), '.claude/projects');
  const out = [];
  for (const proj of safeList(root)) {
    for (const name of safeList(join(root, proj))) {
      if (!name.endsWith('.jsonl')) continue;
      const p = join(root, proj, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs < weekStart - 864e5) continue;
      out.push({ path:p, st, sid:name.slice(0, -6) });
    }
  }
  out.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const head = sessionId ? out.filter(f => f.sid === sessionId) : [];
  const rest = out.filter(f => !head.includes(f));
  return [...head, ...rest].slice(0, 20);
}

async function claudeTotalsRecords(fx, weekStart) {
  const records = [], notes = [];
  const provider = claudeProvider();
  if (!provider) { notes.push('Claude provider 无法证实，未计入'); return { records, notes, files:0, total:0 }; }
  const entry = matchPricing('deepseek-flash', provider, PRICE_TABLE);
  let files = 0;
  for (const f of claudeFiles(weekStart, sessionId)) {
    if (remaining() < 900) { notes.push('时间预算不足，Claude 未扫完'); break; }
    const cachePath = fileCache('claude', f.path);
    const cached = readJson(cachePath);
    let rows = null;
    if (cached?.v === 2 && cached?.size === f.st.size && cached?.mtime === f.st.mtimeMs) rows = cached.rows;
    if (!rows) {
      rows = [];
      const seen = new Set();
      const rl = createInterface({ input: createReadStream(f.path), crlfDelay: Infinity });
      for await (const line of rl) {
        if (remaining() < 600) { notes.push('Claude 解析超预算'); break; }
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e?.type !== 'assistant' || !e.message) continue;
        const key = e.message.uuid ?? e.uuid ?? null;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        const rec = claudeUsage(e.message, Date.parse(e.timestamp ?? '') || null);
        if (!rec) continue;
        const model = resolveAlias(rec.model);
        const c = recordCost({ model, provider, input:rec.input, output:rec.output, cacheWrite:rec.cacheWrite, cacheRead:rec.cacheRead, at:rec.at }, entry, rec.at);
        if (c.status !== 'ok') continue;
        rows.push({ at:rec.at, usd:c.amount, session:f.sid });
      }
      writeJson(cachePath, { v:2, size:f.st.size, mtime:f.st.mtimeMs, rows });
    }
    files++;
    for (const r of rows) records.push({ at:r.at, cny:r.usd * fx.rate, session:r.session, source:'claude' });
  }
  return { records, notes, files, total:claudeFiles(weekStart).length };
}

async function totalsMode(agentProgram, session) {
  const now = Date.now();
  const offsetMinutes = -new Date(now).getTimezoneOffset();
  const dayStart = (() => { const l = new Date(now + offsetMinutes * 60000); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - offsetMinutes * 60000; })();
  const weekStart = dayStart - 6 * 864e5;
  const cachePath = totalsCacheFile(session ?? 'no-session');
  const cached = readJson(cachePath);
  if (cacheFresh(cached, now, TOTALS_TTL) && cached.dayStart === dayStart && cached.key === `${agentProgram}:${session}`) return cached.payload;
  const fx = await fxRate();
  if (!fx?.rate) return { status:'unknown', reason:'无可用汇率，无法汇总人民币', session:{cny:null}, today:{cny:null}, week7:{cny:null} };
  const dsh = await dshTotalsRecords(fx, weekStart);
  const codex = await codexTotalsRecords(fx, weekStart);
  const claude = await claudeTotalsRecords(fx, weekStart);
  const records = [...dsh.records, ...codex.records, ...claude.records];
  const notes = [...new Set([...dsh.notes, ...codex.notes, ...claude.notes])];
  if (claude.files) notes.push('Claude 按当前配置 provider 参考估算，历史来源未单独证实');
  const missing = [];
  if (dsh.files < dsh.total) missing.push('dsh(部分)');
  if (codex.files < codex.total) missing.push('codex(部分)');
  if (!claude.files && !claudeProvider()) missing.push('claude(provider 未证实)');
  const t = totals(records, now, { offsetMinutes, sessionKey: session ?? null, missing });
  const sources = [dsh.files ? 'dsh' : null, codex.files ? 'codex' : null, claude.files ? 'claude' : null].filter(Boolean);
  const payload = {
    ...t,
    status: [t.session.cny, t.today.cny, t.week7.cny].every(v => v === null) ? 'unknown' : ([t.session.cny, t.today.cny, t.week7.cny].some(v => v === null) || missing.length || notes.length ? 'partial' : 'ready'),
    sources, reasons: notes,
    generatedAt: now,
  };
  writeJson(cachePath, { at: now, dayStart, key:`${agentProgram}:${session}`, payload });
  return payload;
}

try {
  if (program === 'totals') out(await totalsMode(id, sessionId));
  if (program === 'codex') out(await codexCost());
  if (program === 'claude') out(await claudeCost());
  if (program === 'dsh-tui') out(await dshCost());
  unknown(`该 Agent 暂不支持会话费用估算：${program}`);
} catch (err) {
  const reason = String(err?.message ?? err);
  const nullBucket = { cny:null, source:'local-usage-records', reason:'汇总失败' };
  out({ status:'error', reason:'费用估算失败', reasons:[reason],
    ...(program === 'totals' ? { session:{...nullBucket}, today:{...nullBucket}, week7:{...nullBucket} } : {}) });
}
