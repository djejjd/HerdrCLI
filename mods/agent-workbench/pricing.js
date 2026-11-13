// 定价匹配与分段：模型名是主键，provider 校验来源；缺价不猜、不返回 0。
// 官方定价页脚注声明的别名（legacy 名称按 Flash 价计费），只收可证实的映射。
export const VERIFIED_ALIASES = Object.freeze({
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
});
export function resolveAlias(model) { return VERIFIED_ALIASES[model] ?? model; }
export function matchPricing(model, provider, table) {
  if (!model || !table?.entries?.length) return null;
  const exact = table.entries.filter(e => e.model === model);
  if (!exact.length) return null;
  // provider 缺失不匹配带 provider 的价格；只有显式 universal 的条目才能跨来源。
  const scoped = exact.filter(e => e.universal === true || (e.provider && provider && e.provider === provider));
  if (!scoped.length) return null;
  return scoped[0];
}
export function segmentByModel(records) {
  const segments = [];
  for (const r of records || []) {
    const last = segments[segments.length - 1];
    if (last && last.model === r.model && last.provider === r.provider) last.records.push(r);
    else segments.push({ model: r.model, provider: r.provider, records: [r] });
  }
  return segments;
}
function tierFor(entry, promptTokens) {
  if (!Array.isArray(entry?.tiers) || !entry.tiers.length) return { tier: null, partial: false };
  if (typeof promptTokens !== 'number') return { tier: null, partial: true };
  const sorted = [...entry.tiers].sort((a, b) => a.maxPrompt - b.maxPrompt);
  const hit = sorted.find(t => promptTokens <= t.maxPrompt);
  return hit ? { tier: hit, partial: false } : { tier: sorted[sorted.length - 1], partial: true };
}
// 峰谷按请求时间（UTC，工作日）选价；中国节假日不在本版模型内，会在 notes 说明。
function selectRates(entry, at) {
  if (!entry?.peakWindowsUtc || !entry.ratesPeak || !entry.ratesOffPeak) return { rates: entry, notes: [] };
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime())) return { rates: entry.ratesOffPeak, notes: ['缺少请求时间，按谷时价估算'] };
  const day = d.getUTCDay();
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  const weekday = day >= 1 && day <= 5;
  const peak = weekday && entry.peakWindowsUtc.some(([s, e]) => minute >= s && minute < e);
  return { rates: peak ? entry.ratesPeak : entry.ratesOffPeak, notes: ['峰谷按 UTC 工作日估算，未含中国节假日'] };
}
// 一次请求的费用；缺维度时返回 partial/range，不伪装精确。
export function recordCost(record, entry, at) {
  if (!entry) return { status: 'unknown', reason: `未知模型或来源：${record?.model ?? '?'}` };
  if (entry.provider && record?.provider && entry.provider !== record.provider) {
    return { status: 'unknown', reason: 'provider 与价格来源不一致' };
  }
  const fields = ['input', 'cacheRead', 'cacheWrite', 'output'];
  if (fields.some(f => typeof record?.[f] !== 'number' || !Number.isFinite(record[f]) || record[f] < 0)) {
    return { status: 'unknown', reason: '用量字段缺失或非法' };
  }
  const promptTokens = record.input + record.cacheRead + record.cacheWrite;
  const { tier, partial: tierPartial } = tierFor(entry, promptTokens);
  const { rates, notes } = selectRates(tier ?? entry, at ?? record.at);
  const r = rates ?? entry;
  const cost = (tokens, rate) => tokens / 1e6 * rate;
  const need = ['input', 'cacheRead', 'output'];
  if (need.some(k => typeof r[k] !== 'number')) return { status: 'unknown', reason: '价格字段不完整' };
  let amount = cost(record.input, r.input) + cost(record.cacheRead, r.cacheRead) + cost(record.output, r.output);
  let partial = tierPartial, range = null;
  if (record.cacheWrite > 0) {
    if (Array.isArray(entry.cacheWriteTiers) && entry.cacheWriteTiers.length) {
      if (Number.isFinite(record.cacheWriteTtlMinutes)) {
        const sorted = [...entry.cacheWriteTiers].sort((a, b) => a.ttlMinutes - b.ttlMinutes);
        const hit = sorted.find(t => t.ttlMinutes >= record.cacheWriteTtlMinutes) ?? sorted[sorted.length - 1];
        amount += cost(record.cacheWrite, hit.rate);
      } else {
        const ratesW = entry.cacheWriteTiers.map(t => t.rate);
        const lo = amount + cost(record.cacheWrite, Math.min(...ratesW));
        const hi = amount + cost(record.cacheWrite, Math.max(...ratesW));
        partial = true; range = [lo, hi];
        amount = lo;
        notes.push('缓存写 TTL 未知，按区间估算');
      }
    } else if (typeof r.cacheWrite === 'number') {
      amount += cost(record.cacheWrite, r.cacheWrite);
    } else {
      return { status: 'unknown', reason: '缺少缓存写价格' };
    }
  }
  return {
    status: 'ok', amount, currency: entry.currency ?? 'USD', partial: partial || undefined,
    range: range ?? undefined, notes,
    priceFrom: entry.fetchedAt ?? entry.effectiveFrom ?? null,
    source: entry.source ?? null, mode: entry.mode ?? null,
  };
}
