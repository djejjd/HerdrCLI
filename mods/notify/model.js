// 纯模型：哪些状态需要介入、会话去重排序、系统通知文案、点击门禁。
// 不 import herdr/gpui-kit，Node 测试可直接加载。

export const LEVEL_RANK = { blocked: 0, error: 1 };

const GENERIC_NAMES = new Set([
  'codex', 'claude', 'claude code', 'claude-code', 'dsh-tui',
  'opencode', 'deepseek harness', 'deepseek-harness',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isGenericProgramName(name) {
  return GENERIC_NAMES.has(text(name).toLowerCase());
}

/** blocked/error 才是“需要人介入”；done/working/idle 一律 null。 */
export function attentionLevel(agent) {
  const status = agent?.status;
  if (status === 'blocked') return 'blocked';
  if (status === 'error') return 'error';
  return null;
}

/**
 * 界面名：workbench.name 优先，其次终端启动名，最后“会话”。
 * 程序名（codex/claude/dsh-tui/...）不进入标题；t 号只追加一次。
 */
export function displayName(term, target) {
  const rawTarget = String(target ?? '');
  const short = rawTarget.split('/').filter(Boolean).pop() || '';
  const label = text(term?.labels?.['workbench.name']);
  const name = text(term?.name);
  let base = label && !isGenericProgramName(label) ? label : '';
  if (!base && name && !isGenericProgramName(name)) base = name;
  if (!base) base = '会话';
  if (!short || base.includes(`(${short})`) || base.includes(`（${short}）`)) return base;
  return `${base}(${short})`;
}

function rank(item) {
  return LEVEL_RANK[item?.level] ?? 2;
}

function byTarget(item) {
  return String(item?.target ?? '');
}

/** blocked 优先 error；同级按 since 升序；最后按 target 保证稳定。 */
export function sortItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    const s = (Number(a?.since) || 0) - (Number(b?.since) || 0);
    if (s) return s;
    const at = byTarget(a);
    const bt = byTarget(b);
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

/**
 * 由 live agents 重建需要介入项：
 * - 同 target 只留一条；level/seq 变化不重置 since（同一 episode）。
 * - dismissed 只压同 seq；新 seq 重新出现。
 * - 返回 removed，供调用方移除系统通知。
 */
export function reconcileItems(prevItems, agents, terminals, now, dismissed) {
  const prev = Array.isArray(prevItems) ? prevItems : [];
  const prevBy = new Map(prev.filter(x => x && x.target).map(x => [x.target, x]));
  const termBy = new Map((Array.isArray(terminals) ? terminals : [])
    .filter(t => t && t.address).map(t => [t.address, t]));
  const dis = dismissed && typeof dismissed === 'object' && !Array.isArray(dismissed) ? dismissed : {};
  const items = [];
  const seen = new Set();
  for (const ag of Array.isArray(agents) ? agents : []) {
    if (!ag || typeof ag.address !== 'string' || seen.has(ag.address)) continue;
    const level = attentionLevel(ag);
    if (!level) continue;
    const seq = Number.isFinite(Number(ag.seq)) ? Number(ag.seq) : 0;
    if (dis[ag.address] && Number(dis[ag.address].seq) === seq) continue;
    seen.add(ag.address);
    const old = prevBy.get(ag.address);
    items.push({
      target: ag.address,
      level,
      seq,
      since: old && Number.isFinite(Number(old.since)) ? Number(old.since) : now,
      title: displayName(termBy.get(ag.address) ?? null, ag.address),
      space: typeof ag.space_name === 'string' ? ag.space_name : '',
    });
  }
  items.sort((a, b) => rank(a) - rank(b) || a.since - b.since || (a.target < b.target ? -1 : 1));
  const removed = prev.filter(x => x && x.target && !seen.has(x.target)).map(x => x.target);
  const changed = JSON.stringify(prev) !== JSON.stringify(items);
  return { items, removed, changed };
}

/** 最多 max 条；more 是“还有 N 条”。 */
export function visibleSlice(items, max = 3) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(0, Number(max) || 0);
  return { visible: list.slice(0, n), more: Math.max(0, list.length - n) };
}

export function notificationKey(item) {
  return `${item?.target ?? ''}:${item?.seq ?? 0}`;
}

export function notificationGroup(target) {
  const safe = String(target ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  return `herdr-notify-${safe}`;
}

/** 只接受可放进 -execute 的 target；不安全的宁可不发系统通知。 */
export function safeTarget(target) {
  const s = String(target ?? '');
  if (!s || s.length > 160) return null;
  return /^[A-Za-z0-9._:/-]+$/.test(s) ? s : null;
}

/** 只在 inactive 发；标题/正文全中文，不使用程序名或英文 needs you。 */
export function notificationFor(item, active) {
  if (active !== false || !item) return null;
  if (item.level !== 'blocked' && item.level !== 'error') return null;
  const name = item.title || '会话';
  const blocked = item.level === 'blocked';
  return {
    target: item.target,
    key: notificationKey(item),
    group: notificationGroup(item.target),
    title: `${name} ${blocked ? '需要你确认' : '出错了，需要你处理'}`,
    body: blocked ? '等待你在 Herdr 里确认' : '点击回到该会话',
  };
}

export function hitBounds(bounds, local) {
  if (!bounds || !local) return false;
  const x = Number(local.x);
  const y = Number(local.y);
  const w = Number(bounds.width);
  const h = Number(bounds.height);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
    && x >= 0 && y >= 0 && x <= w && y <= h;
}

export function pointInBounds(bounds, point) {
  if (!bounds || !point) return false;
  const x = Number(point.x);
  const y = Number(point.y);
  const bx = Number(bounds.x);
  const by = Number(bounds.y);
  const w = Number(bounds.width);
  const h = Number(bounds.height);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(bx) && Number.isFinite(by)
    && Number.isFinite(w) && Number.isFinite(h)
    && x >= bx && y >= by && x <= bx + w && y <= by + h;
}

export function sameRect(a, b, tolerance = 2) {
  if (!a || !b) return false;
  const t = Number(tolerance) || 0;
  return Math.abs(Number(a.x) - Number(b.x)) <= t
    && Math.abs(Number(a.y) - Number(b.y)) <= t
    && Math.abs(Number(a.width) - Number(b.width)) <= t
    && Math.abs(Number(a.height) - Number(b.height)) <= t;
}

function deny(reason) {
  return { allow: false, reason };
}

/**
 * 点击门禁：只有真实 mouse_up、已 armed、按下/抬起同一按钮且框没移动、
 * 卡片/该行可见 ≥250ms、命中真实 bounds 时才放行。
 */
export function clickGate(state = {}) {
  if (state.eventType !== 'mouse_up') return deny('event');
  if (state.inRender) return deny('in_render');
  if (!state.armed) return deny('not_armed');
  if (!state.pressTarget || state.pressTarget !== state.target) return deny('press_mismatch');
  if (!Number.isFinite(state.pressAt) || !Number.isFinite(state.now)
    || state.now - state.pressAt > 1500) return deny('press_stale');
  if (!Number.isFinite(state.lastMoveAt) || !Number.isFinite(state.now)
    || state.now - state.lastMoveAt > 1500) return deny('stale_pointer');
  if (!state.bounds || !state.local) return deny('no_bounds');
  if (!state.position) return deny('no_position');
  if (!sameRect(state.pressBounds, state.bounds, 2)) return deny('bounds_moved');
  if (!Number.isFinite(state.visibleAge) || state.visibleAge < 250) return deny('visible_too_new');
  if (!hitBounds(state.bounds, state.local)) return deny('outside');
  if (!pointInBounds(state.bounds, state.position)) return deny('outside_window');
  if (state.lastGoTarget && state.lastGoTarget === state.target
    && Number.isFinite(state.lastGoAt) && state.now - state.lastGoAt < 1500) return deny('repeat');
  return { allow: true, reason: 'ok' };
}
