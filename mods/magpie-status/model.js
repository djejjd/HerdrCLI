// 只把同厂商的额度卡归到当前路由，明确账号时按账号匹配。
export function quotaSelection(cards, provider, account) {
  const candidates = provider ? cards.filter(card => card.provider === provider) : [];
  const matches = account ? candidates.filter(card => card.user === account) : [];
  const current = matches.length === 1 ? matches[0] : null;
  const related = candidates.length || provider !== 'openai' ? candidates
    : cards.filter(card => card.provider === 'codex');
  const reference = !account && related.length === 1 ? related[0] : null;
  return {current, reference, candidates:related, others:cards.filter(card => !related.includes(card))};
}

export function quotaReadings(card) {
  if (card.error) return [];
  const names = {'5 hours':'5h', '7 days':'周'};
  const readings = (card.windows ?? []).filter(window =>
    Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100
  ).map(window => ({
    label:(names[window.name] || window.name || '额度') + ' 剩',
    value:Math.floor(window.remaining) + '%',
    low:window.remaining < 10,
    reset:window.resetsAt,
  }));
  if (typeof card.balance === 'string' || typeof card.balance === 'number') {
    const value = String(card.balance).trim();
    const amount = value.match(/^[^0-9+.-]*([+-]?\d+(?:\.\d+)?)[^0-9]*$/);
    if (value) readings.push({label:'余额',value,low:amount !== null && Number(amount[1]) <= 0});
  }
  return readings;
}

export function quotaLines(card) {
  return quotaReadings(card).map(reading => reading.label + ' ' + reading.value);
}

// 用当前 PID 的启动时间过滤历史日志，只接受唯一主会话。
export function codexSessionQuery(pid, started) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(started) || started <= 0) {
    throw new Error('Invalid process identity');
  }
  return `SELECT DISTINCT t.id AS sessionId, t.model
    FROM logs AS l JOIN state.threads AS t ON t.id = l.thread_id
    WHERE l.process_uuid LIKE 'pid:${pid}:%' AND l.ts >= ${started}
      AND (t.thread_source = 'user' OR (t.thread_source IS NULL AND t.source = 'cli'))
    LIMIT 2;`;
}

// 主会话模型优先。只使用同模型路由中的额度账号。
export function modelRoute(sessionModel, route) {
  const split = value => {
    const parts = (typeof value === 'string' ? value : '').replace(/^magpie\//, '').split('/');
    const model = parts.pop();
    return {model, provider:parts.join('/') || null};
  };
  const primary = split(sessionModel);
  const recent = split(route?.model || route?.asked);
  const aliases = new Set(['codex', 'openai']);
  const sameProvider = !primary.provider || primary.provider === recent.provider
    || (aliases.has(primary.provider) && aliases.has(recent.provider));
  const matching = !primary.model || (primary.model === recent.model && sameProvider);
  const model = primary.model || recent.model;
  if (!model) return null;
  return {
    model,
    provider:primary.provider || (matching ? recent.provider : null),
    account:matching && typeof route?.served?.account === 'string' ? route.served.account : null,
  };
}
