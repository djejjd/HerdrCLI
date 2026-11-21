// 只把同厂商的额度卡归到当前路由，明确账号时按账号匹配。
export function quotaSelection(cards, provider, account) {
  const candidates = provider ? cards.filter(card => card.provider === provider) : [];
  const matches = account ? candidates.filter(card => card.user === account) : [];
  const current = matches.length === 1 ? matches[0] : null;
  return {current, candidates, others: cards.filter(card => !candidates.includes(card))};
}

export function quotaLines(card, details = false) {
  const lines = (card.windows ?? []).filter(window =>
    Number.isFinite(window.remaining) && window.remaining >= 0 && window.remaining <= 100
  ).map(window => {
    const reset = new Date(window.resetsAt ?? '');
    const time = details && Number.isFinite(reset.getTime()) ? ' · ' + reset.toLocaleString() + ' 重置' : '';
    return (window.name || '额度') + ' 剩 ' + Math.floor(window.remaining) + '%' + time;
  });
  if (typeof card.balance === 'string' || typeof card.balance === 'number') lines.push('余额 ' + card.balance);
  return lines;
}
