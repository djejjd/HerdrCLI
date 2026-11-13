// 币种与汇率：CNY 原币不换算；其他币种按“当日获取的最新可用参考汇率”折 CNY。
export function isCny(currency) { return String(currency ?? '').toUpperCase() === 'CNY'; }
export function localDayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// fx: { rate, quoteDate, source } —— quoteDate 是报价日期，不保证是今天。
export function convertToCny(amount, currency, fx, now = new Date()) {
  if (!Number.isFinite(amount)) return { status: 'unknown', reason: '金额无效' };
  if (isCny(currency)) return { status: 'ok', amount, converted: false, currency: 'CNY' };
  if (!fx || !Number.isFinite(fx.rate) || fx.rate <= 0) return { status: 'unavailable', reason: '无可用汇率' };
  const stale = fx.quoteDate !== localDayKey(now);
  return {
    status: 'ok', amount: amount * fx.rate, converted: true, currency: 'CNY',
    fx: { rate: fx.rate, quoteDate: fx.quoteDate, source: fx.source ?? null, stale },
  };
}

// 汇率解析顺序：当日缓存 → 直连 → 系统代理/curl → 旧缓存(stale) → 不可用。
export async function resolveFxRate({ cache = null, now = new Date(), fetchJson, curlJson } = {}) {
  const today = localDayKey(now);
  if (cache?.date === today && Number.isFinite(cache.rate) && cache.rate > 0) return cache;
  for (const fn of [fetchJson, curlJson]) {
    if (typeof fn !== 'function') continue;
    try {
      const j = await fn();
      const rate = Number(j?.rate ?? j?.rates?.CNY);
      if (Number.isFinite(rate) && rate > 0) {
        return { date: today, rate, quoteDate: j?.quoteDate ?? j?.date ?? null, source: j?.source ?? 'fx', fetchedAt: now.getTime() };
      }
    } catch {}
  }
  return cache?.rate ? { ...cache, stale: true } : null;
}
