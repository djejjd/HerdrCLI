// 视觉格式纯逻辑：完整分支断点、额度指标组、费用金额；不读写终端状态。

// 把 branch 按分隔符切成「分隔符留在前一块」的 token；渲染层 flex-wrap 只在 token 边界换行，
// 避免斜杠/连字符落到新行首。原文完整保留。
export function branchTokens(branch) {
  const raw = String(branch ?? '');
  const out = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '/' || raw[i] === '-') {
      out.push(raw.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < raw.length) out.push(raw.slice(start));
  return out.filter(Boolean);
}

export function branchText(branch) {
  // 斜杠/连字符必须留在前一行：前面用 word joiner 禁止断开，后面给零宽断点。
  // 原文不变，不缩写、不加省略号。
  return String(branch ?? '').replace(/([/-])(?=\S)/g, '\u2060$1\u200B');
}

export function quotaGroups(quota) {
  return [quota?.primary, quota?.secondary]
    .filter(w => w && w.label && w.remaining !== null && w.remaining !== undefined && w.remaining !== ''
      && Number.isFinite(Number(w.remaining)))
    .map(w => ({
      label: w.label === '周' ? '本周' : String(w.label),
      value: `${Math.round(Number(w.remaining))}%`,
      low: Number(w.remaining) <= 10,
    }));
}

export function feeLabel(kind) {
  return kind === 'partial' ? '本会话估算（部分）' : '本会话估算';
}

export function feeAmount(state) {
  if (state?.cny === null || state?.cny === undefined || state?.cny === '') return null;
  const cny = Number(state.cny);
  if (!Number.isFinite(cny) || cny < 0) return null;
  const hi = Array.isArray(state?.rangeCny) && state.rangeCny.length === 2 ? Number(state.rangeCny[1]) : null;
  const range = Number.isFinite(hi) && hi > cny ? `–${hi.toFixed(2)}` : '';
  return `¥${cny.toFixed(2)}${range}`;
}

// 费用三合一：s=本会话、1d=今天、7d=近 7 天；null/0 用占位，绝不显示 ¥0.00。
export function feeSegments(state) {
  const pick = (bucket) => {
    const raw = bucket?.cny;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    // 10 元以上取一位小数（167.91 → ¥167.9），小额保留两位（2.04 → ¥2.04）。
    return `¥${n < 10 ? n.toFixed(2) : n.toFixed(1)}`;
  };
  return [
    { key:'s',  label:'s',  value:pick(state?.session) },
    { key:'1d', label:'1d', value:pick(state?.today) },
    { key:'7d', label:'7d', value:pick(state?.week7) },
  ];
}
// tooltip：解释三段含义与覆盖范围，并原样带上接口给的 reasons。
export function feeTooltip(state) {
  const cover = (bucket) => bucket?.coverage?.complete === false ? '部分记录' : (bucket?.cny == null ? '无数据' : '覆盖完整');
  const lines = [
    's：本会话 · 1d：今天 · 7d：近 7 天',
    `覆盖 s：${cover(state?.session)} · 1d：${cover(state?.today)} · 7d：${cover(state?.week7)}`,
  ];
  // 每段自己的 reason（如「部分来源缺失」）要如实说出，不和顶层 reasons 混掉。
  for (const [key, bucket] of [['s', state?.session], ['1d', state?.today], ['7d', state?.week7]]) {
    if (bucket?.reason) lines.push(`${key}：${bucket.reason}`);
  }
  const reasons = Array.isArray(state?.reasons) ? state.reasons : (state?.reason ? [state.reason] : []);
  if (reasons.length) lines.push(...reasons);
  lines.push('API 等价估算');
  return lines.join(' · ');
}

// 无感刷新：有上次有效值时，loading/error 都继续显示旧值；
// 只有从未拿到过值（无 memory）才把 loading/error 交给界面显示。
export function silentState(state, memory) {
  if (!state) return memory?.state ?? null;
  if (state.status === 'loading' || state.status === 'error') return memory?.state ?? state;
  return state;
}
// 能作为「旧值」记住的状态：额度 ready / 费用 ready|partial。
export function hasValue(state) {
  return state?.status === 'ready' || state?.status === 'partial';
}

// 最近刷新时间只进 tooltip，不做常驻文案。
export function refreshStamp(ms) {
  if (!ms) return null;
  const d = new Date(Number(ms));
  return `最近刷新 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 重置行：剩余时长取整；5h 窗口用小时，周窗口不足一天也用小时。
function remainShort(sec, nowMs) {
  const ms = Number(sec) * 1000 - nowMs;
  if (!Number.isFinite(ms)) return null;
  const hours = Math.max(0, Math.round(ms / 3600e3));
  return hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;
}
export function resetHint(state, nowMs = Date.now()) {
  const parts = [];
  const five = state?.primary?.resetsAt ? remainShort(state.primary.resetsAt, nowMs) : null;
  const week = state?.secondary?.resetsAt ? remainShort(state.secondary.resetsAt, nowMs) : null;
  if (five) parts.push(five);
  if (week) parts.push(week);
  return parts.length ? `重置 ${parts.join(' / ')}` : null;
}
function exactTime(sec) {
  return new Date(Number(sec) * 1000).toLocaleString('zh-CN', { hour12:false });
}
// 额度 tooltip：精确重置时间 + 快照时间 + 三段费用 + reasons（不占版面高度）。
export function quotaTooltip(state, { ageMs = null, refreshing = false, refreshedAt = null, failure = null, usageState = null } = {}) {
  const lines = [];
  if (state?.primary?.resetsAt) lines.push(`5h 重置 ${exactTime(state.primary.resetsAt)}`);
  if (state?.secondary?.resetsAt) lines.push(`周重置 ${exactTime(state.secondary.resetsAt)}`);
  if (ageMs !== null) lines.push(`快照 ${Math.max(0, Math.round(ageMs / 60000))} 分钟前`);
  if (refreshing) lines.push('刷新中');
  const stamp = refreshStamp(refreshedAt);
  if (stamp) lines.push(stamp);
  if (failure) lines.push(`上次刷新失败：${failure}`);
  if (usageState) {
    const fees = feeSegments(usageState).map(s => `${s.label}:${s.value ?? '–'}`).join(' · ');
    lines.push(`费用 ${fees}`);
    const reasons = Array.isArray(usageState.reasons) ? usageState.reasons : (usageState.reason ? [usageState.reason] : []);
    lines.push(...reasons);
  }
  return lines.join(' · ');
}

// 所有可见 footer 分支共用一个高度；三合一费用行在 240 宽会换行，
// 所以取能容纳两行的固定值，不按 Agent/页面/额度/fee 形态变化。
export const FOOTER_H = 96;
export function footerHeight(width, kind) {
  // kind deliberately ignored: a visible branch must never choose its own height.
  return FOOTER_H;
}

// quota 状态决定底栏主行：费用行只在 unknown（无数据源）时使用；
// loading/error/快照过旧一律显示额度状态，不能费用行盖住。
export function quotaLineKind(status, age, hasUsage = false, reason = '') {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (status === 'unknown') {
    // quota.mjs 会把“快照过旧”也归为 unknown；它不是无数据源，必须显示额度状态。
    if (/快照过旧|无快照时间/.test(String(reason ?? ''))) return 'stale';
    return hasUsage ? 'usage' : 'unknown';
  }
  if (status === 'ready') return age === null || age > 60 * 60 * 1000 ? 'stale' : 'quota';
  return 'unknown';
}
