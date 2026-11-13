// 用量归一：Codex 累计签名去重 + 逐请求段 + 分代；Claude 消息去重；DSH 账本复用。
export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const totalIn = usage.input_tokens;
  const output = usage.output_tokens;
  const cached = usage.cached_input_tokens ?? 0;
  const written = usage.cache_write_input_tokens ?? 0;
  if (![totalIn, output, cached, written].every(v => typeInt(v))) return null;
  if (cached + written > totalIn) return null;
  // input 是未命中缓存的互斥桶；reasoning 已含在 output 里，不再另加。
  return { input: totalIn - cached - written, output, cacheWrite: written, cacheRead: cached };
}
function typeInt(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0; }
export function signature(counts) {
  return counts ? `${counts.input}:${counts.cacheRead}:${counts.cacheWrite}:${counts.output}` : null;
}
export function totalOf(counts) {
  return counts ? counts.input + counts.cacheRead + counts.cacheWrite + counts.output : 0;
}
// 增量解析：状态可持久化；segments 只含用量元数据，不含正文。
export function newCodexState() {
  return { version: 1, seen: [], lastTotal: 0, generation: 0, model: null, segments: [], reasons: [] };
}
export function feedCodex(state, events) {
  const seen = new Set(state.seen);
  for (const ev of events || []) {
    const p = ev?.payload;
    const isTurnContext = ev?.type === 'turn_context' || p?.type === 'turn_context';
    if (isTurnContext && typeof p?.model === 'string' && p.model) { state.model = p.model; continue; }
    if (p?.type !== 'token_count') continue;
    const info = p.info;
    const total = usageTokens(info?.total_token_usage);
    const last = usageTokens(info?.last_token_usage);
    if (!total || !last) { pushReason(state, '用量字段缺失'); continue; }
    const sum = totalOf(total);
    if (sum < state.lastTotal) { state.generation++; seen.clear(); state.reasons = []; pushReason(state, '累计回退，按新分代处理'); }
    state.lastTotal = sum;
    const sig = signature(total);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const at = Date.parse(ev.timestamp ?? '') || null;
    if (!last.input && !last.output && !last.cacheRead && !last.cacheWrite) continue;
    state.segments.push({ at, model: state.model, generation: state.generation, ...last });
    if (state.segments.length > 20000) { pushReason(state, '分段过多，已截断'); break; }
  }
  state.seen = [...seen].slice(-20000);
  return state;
}
function pushReason(state, reason) { if (!state.reasons.includes(reason)) state.reasons.push(reason); }
export function summarizeCodex(state) {
  const covered = state.segments.reduce((a, s) => a + s.input + s.cacheRead + s.cacheWrite + s.output, 0);
  return { segments: state.segments, model: state.model, generation: state.generation, covered, final: state.lastTotal, complete: covered === state.lastTotal, reasons: state.reasons };
}
// 解析 Codex JSONL 记录（对象数组，纯函数）；累计回退视为 compact/恢复，开新分代并清空签名。
export function parseCodexEvents(events) {
  return summarizeCodex(feedCodex(newCodexState(), events));
}
// 一条 Claude assistant 消息；消息 uuid 去重后按 usage 原样拆桶。
export function claudeUsage(message, at) {
  const u = message?.usage;
  if (!u) return null;
  const input = u.input_tokens, output = u.output_tokens;
  const cacheRead = u.cache_read_input_tokens ?? 0, cacheWrite = u.cache_creation_input_tokens ?? 0;
  if (![input, output, cacheRead, cacheWrite].every(typeInt)) return null;
  return { at: at ?? null, model: message.model ?? null, input, output, cacheWrite, cacheRead };
}

// DSH 账本同一会话多天记录必须是累计递增；否则口径不一致，不能相加。
export function cumulativeOk(entries) {
  const rows = [...(entries || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  for (let i = 1; i < rows.length; i++) {
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (Number(rows[i]?.[k] ?? 0) < Number(rows[i - 1]?.[k] ?? 0)) return false;
    }
  }
  return rows.length > 0;
}
// 只接受精确会话 ID 对应的文件；多候选由调用方判 unknown。
export function matchSessionFile(paths, sessionId) {
  if (!sessionId) return [];
  const suffix = `-${sessionId}.jsonl`;
  return (paths || []).filter(p => p.endsWith(suffix) || p.endsWith(`/${sessionId}.jsonl`));
}

// 文件身份/截断检测：路径、inode、schema 变化或文件变短都要重置增量状态。
export function cacheInvalid(cache, path, st) {
  return !cache || cache.version !== 1 || cache.path !== path || cache.inode !== st?.ino || st.size < (cache.offset ?? 0);
}
// Appended text 里只有最后一行可能不完整；返回可安全消费的字节数（含换行）。
export function consumedBytes(offset, text) {
  const nl = text.lastIndexOf('\n');
  if (nl < 0) return null;
  return offset + Buffer.byteLength(text.slice(0, nl)) + 1;
}

// footer 纯格式化：切 key 时绝不显示旧数字；非法金额不归零/不显示 NaN。
export function formatUsage(state, sameKey) {
  if (!state || state.status === 'idle') return null;
  const reasons = Array.isArray(state.reasons) ? state.reasons : (state.reason ? [state.reason] : []);
  const tip = reasons.join(' · ');
  if (!sameKey) return { kind:'loading', text:'费用估算读取中…', tooltip:'切换会话后重新读取' };
  if (state.status === 'loading') return { kind:'loading', text:'费用估算读取中…', tooltip:tip || null };
  if (state.status === 'error') return { kind:'error', text:'费用估算失败', tooltip:tip || null };
  if (state.status === 'unknown') return { kind:'unknown', text:`无法估价${state.reason ? `：${state.reason}` : ''}`, tooltip:tip || null };
  if (state.cny === null || state.cny === undefined || state.cny === '') return { kind:'unknown', text:'无法估价：金额无效', tooltip:tip || null };
  const cny = Number(state.cny);
  if (!Number.isFinite(cny) || cny < 0) return { kind:'unknown', text:'无法估价：金额无效', tooltip:tip || null };
  const hi = Array.isArray(state.rangeCny) && state.rangeCny.length === 2 ? Number(state.rangeCny[1]) : null;
  const range = Number.isFinite(hi) && hi > cny ? `–${hi.toFixed(2)}` : '';
  const lines = [];
  if (state.original) lines.push(`原币 ${Number(state.original.amount).toFixed(4)} ${state.original.currency}`);
  if (state.fx) lines.push(`汇率 ${state.fx.rate}（报价日 ${state.fx.quoteDate ?? '未知'}${state.fx.stale ? '，非当日' : ''}）`);
  if (state.coverage) lines.push(state.coverage.complete ? '覆盖完整' : (state.coverage.from ? `自 ${new Date(state.coverage.from).toLocaleString()}` : '部分记录'));
  if (state.priceSource) lines.push(`价格来源 ${state.priceSource}${state.priceFetchedAt ? `（${state.priceFetchedAt}）` : ''}`);
  if (reasons.length) lines.push(...reasons);
  return {
    kind: state.status === 'partial' ? 'partial' : 'ready',
    text: `本会话 ≈¥${cny.toFixed(2)}${range}${state.status === 'partial' ? '（部分）' : ''} · API 等价估算`,
    tooltip: lines.join(' · ') || null,
  };
}

// 汇总窗口：本地日界（当天 00:00 起），近 7 天含今天；缺源写进 reason，不补数。
export function cacheFresh(cache, now, ttlMs = 30_000) {
  return !!cache && typeof cache.at === 'number' && cache.at <= now && now - cache.at < ttlMs;
}
function dayStartLocal(now, offsetMinutes) {
  const local = new Date(now + offsetMinutes * 60_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMinutes * 60_000;
}
export function totals(records, now, { offsetMinutes = -new Date(now).getTimezoneOffset(), sessionKey = null, missing = [] } = {}) {
  const dayStart = dayStartLocal(now, offsetMinutes);
  const weekStart = dayStart - 6 * 86_400_000;
  const rows = (records ?? []).filter(r => r && Number.isFinite(r.at) && Number.isFinite(r.cny) && r.at <= now);
  const sum = (list) => list.length ? list.reduce((a, r) => a + r.cny, 0) : null;
  const coverage = (list) => list.length ? { from: Math.min(...list.map(r => r.at)), to: Math.max(...list.map(r => r.at)) } : null;
  const reason = (list, label) => list.length
    ? (missing.length ? `部分来源缺失：${missing.join(',')}` : null)
    : (missing.length ? `无可用记录；缺少来源：${missing.join(',')}` : `${label}无可用记录`);
  const sessionRows = sessionKey ? rows.filter(r => r.session === sessionKey) : [];
  const todayRows = rows.filter(r => r.at >= dayStart);
  const weekRows = rows.filter(r => r.at >= weekStart);
  return {
    session: { cny: sessionKey ? sum(sessionRows) : null, source:'local-usage-records', reason: sessionKey ? (sessionRows.length ? null : '该会话无可用记录') : '缺少会话标识', coverage: coverage(sessionRows) },
    today: { cny: sum(todayRows), source:'local-usage-records', reason: reason(todayRows, '当天'), coverage: coverage(todayRows) },
    week7: { cny: sum(weekRows), source:'local-usage-records', reason: reason(weekRows, '近7天'), coverage: coverage(weekRows) },
    offsetMinutes, dayStart, weekStart,
  };
}
