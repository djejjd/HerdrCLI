// 待批账本的纯逻辑：解析只读 Markdown 表格、计数口径、打开目标的安全判定、
// 以及带作废机制的异步读取。不依赖 herdr/gpui，便于单测。
// mod 从不写账本：清除只认账本里的状态列。

const WHAT = '要你做什么';
const MAX_ROWS = 200;
const MAX_CELL = 200;
// 账本会把结论写在状态后面（如「已处理（选 A）」），按前缀判定，避免把已处理算回未处理。
const DONE_RE = /^(已处理|已完成|done|closed)(?=$|[\s（(,，;；:：])/i;

/** 拆一行表格：去掉首尾竖线，转义的 \| 还原为字面竖线。null 行按空处理。 */
export function splitRow(line) {
  if (typeof line !== 'string') return [];
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const cut = s => {
  const v = String(s ?? '').trim();
  return v.length > MAX_CELL ? `${v.slice(0, MAX_CELL)}…` : v;
};

/** 解析账本：只认第一个含「要你做什么」的表头之后的连续表格行。
 *  返回 { rows, error }；error 为 null / 'no-header' / 'no-what' / 'unreadable'。
 *  rows 里保留已完成行（done=true），计数由 countRows 决定。 */
export function parseLedger(text) {
  if (typeof text !== 'string') return { rows: [], error: 'unreadable' };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // 账本前面可能有别的表（元信息、索引）：一直扫到含「要你做什么」的表头为止。
  // 一张表都没有 = no-header；有表但没有必需列 = no-what。
  let header = null;
  let start = 0;
  let sawTable = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    const cells = splitRow(lines[i]);
    if (cells.length >= 2 && cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
    sawTable = true;
    if (cells.includes(WHAT)) { header = cells; start = i + 1; break; }
  }
  if (!header) return { rows: [], error: sawTable ? 'no-what' : 'no-header' };
  const at = name => header.indexOf(name);
  if (at(WHAT) < 0) return { rows: [], error: 'no-what' };
  // 状态列必填：没有它就无法区分未处理与已处理，不能猜。
  if (at('状态') < 0) return { rows: [], error: 'no-status' };
  const iWhat = at(WHAT), iImpact = at('不做会怎样'), iWhere = at('去哪点'), iSpace = at('Space');
  const iType = at('类型'), iSuggest = at('建议'), iOptions = at('备选');
  const iAt = at('提出时间'), iProject = at('项目'), iStatus = at('状态');
  const rows = [];
  for (let i = start; i < lines.length && rows.length < MAX_ROWS; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    const cells = splitRow(line);
    if (cells.length >= 2 && cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
    if (cells.length < 2) continue;
    const what = cut(cells[iWhat]);
    // 账本示例行按 t19 约定：含「（示例）」即跳过。
    if (!what || /（示例）|\(示例\)/.test(what)) continue;
    const status = iStatus >= 0 ? String(cells[iStatus] ?? '').trim() : '';
    rows.push({
      what,
      impact: cut(iImpact >= 0 ? cells[iImpact] : ''),
      where: cut(iWhere >= 0 ? cells[iWhere] : ''),
      proposedAt: cut(iAt >= 0 ? cells[iAt] : ''),
      // 缺 Space 列或空格子 = 全局，所有 Space 都显示（安全侧）。
      space: cut(iSpace >= 0 ? cells[iSpace] : ''),
      // 类型缺失/未知一律按授权（更严格的解释）。
      type: (iType >= 0 ? cut(cells[iType]) : '') === '选择' ? '选择' : '授权',
      suggestion: cut(iSuggest >= 0 ? cells[iSuggest] : ''),
      options: (iOptions >= 0 ? String(cells[iOptions] ?? '') : '')
        .split(/[｜|]/).map(x => x.trim()).filter(Boolean).slice(0, 2),
      project: cut(iProject >= 0 ? cells[iProject] : ''),
      done: DONE_RE.test(status.trim()),
    });
  }
  // front-matter 的「监督者: t19」是唯一来源；没有就留空，由 UI 禁用动作。
  const meta = {};
  for (const line of lines) {
    const m = /^\s*监督者\s*[:：]\s*(\S+)/.exec(line);
    if (m) { meta.supervisor = m[1]; break; }
  }
  return { rows, error: null, meta };
}

/** 一行的稳定 key：内容变则 key 变，已读标记随之失效。 */
export function rowKey(row) {
  const text = `${row?.what ?? ''}\u0000${row?.where ?? ''}\u0000${row?.proposedAt ?? ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 由 ISO 提出时间现算“提了多久”：刚刚 / N 分钟 / N 小时 / N 天；缺列或坏值给时间未知。 */
export function ageText(row, now = Date.now()) {
  const raw = row?.proposedAt;
  if (typeof raw !== 'string' || !raw.trim()) return '时间未知';
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return '时间未知';
  const ms = Math.max(0, now - at);
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (ms < min) return '刚刚';
  if (ms < hour) return `${Math.floor(ms / min)} 分钟`;
  if (ms < day) return `${Math.floor(ms / hour)} 小时`;
  return `${Math.floor(ms / day)} 天`;
}

/** 未处理的条数：只认账本状态列，已读标记不参与（akcs 参数仅为调用方兼容）。 */
export function countRows(rows, _acks) {
  return Array.isArray(rows) ? rows.filter(r => r && !r.done).length : 0;
}

/** 弹层分页：每页 pageSize 条，页码越界夹取；顺序保持账本行序。 */
export function listPlan(rows, page = 0, pageSize = 6) {
  const all = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(all.length / size));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const start = at * size;
  const shown = all.slice(start, start + size);
  return { shown, page: at, pages, start, end: start + shown.length, more: all.length - start - shown.length };
}

/** chip 的显示状态：0 行隐藏；账本缺失与读取/解析失败都要露出“待批 ?”，不静默。 */
export function chipState(state) {
  if (!state || state.kind === 'hidden' || state.kind === 'empty') return { kind: 'hidden' };
  if (state.kind === 'missing') return { kind: 'missing' };
  if (state.kind === 'error') return { kind: 'error', reason: state.reason ?? '' };
  const count = Number(state.count) || 0;
  return count > 0 ? { kind: 'count', count } : { kind: 'hidden' };
}

const URL_OK = new Set(['http:', 'https:']);

/** 「去哪点」的安全判定：只放行 http/https（有 host、无 userinfo）
 *  与 home 之下的绝对路径（无 .. / . 段、不以 - 开头）。
 *  返回 { kind: 'url' | 'path', value } 或 null；存在性由调用方 stat 再查。 */
export function classifyTarget(raw, home) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 500) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  if (s.startsWith('-')) return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  if (m) {
    if (!URL_OK.has(`${m[1].toLowerCase()}:`)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!u.hostname || u.username || u.password) return null;
    return { kind: 'url', value: u.toString() };
  }
  const base = typeof home === 'string' && home ? home.replace(/\/+$/, '') : '';
  if (!base) return null;
  let p = s;
  if (p === '~' || p.startsWith('~/')) p = `${base}/${p.slice(2)}`;
  if (!p.startsWith('/')) return null;
  if (p.split('/').some(seg => seg === '..' || seg === '.')) return null;
  if (p !== base && !p.startsWith(`${base}/`)) return null;
  return { kind: 'path', value: p };
}

/** 账本读取的状态机：read 注入、在途结果按 generation 作废、close 为终态。
 *  state: { kind: 'hidden' } | { kind: 'count', count, rows } | { kind: 'error', reason }
 *  at: 最后一次成功读取的时间（0 表示还没读到）。 */
export class PendingStore {
  constructor({ read, now = () => Date.now() } = {}) {
    this.read = read ?? (async () => null);
    this.now = now;
    this.state = { kind: 'hidden' };
    this.at = 0;
    this.generation = 0;
    this.closed = false;
  }

  /** 读一次；关闭或已被更晚的读取取代时保持原状态。 */
  async refresh() {
    if (this.closed) return this.state;
    const gen = (this.generation += 1);
    const stale = () => this.closed || gen !== this.generation;
    try {
      const text = await this.read();
      if (stale()) return this.state;
      let next;
      // 账本不存在不等于“没有待批”：要显示缺失态，只有真读到 0 行才隐藏。
      if (text == null) next = { kind: 'missing' };
      else {
        const parsed = parseLedger(text);
        if (parsed.error) next = { kind: 'error', reason: parsed.error };
        else {
          const rows = parsed.rows;
          const count = countRows(rows);
          // 空态与“没读到”必须分开：浮层在 empty 时要自动关闭。
          next = count > 0 ? { kind: 'count', count, rows, meta: parsed.meta ?? {} } : { kind: 'empty', rows, meta: parsed.meta ?? {} };
        }
      }
      this.state = next;
      this.at = this.now();
      return next;
    } catch {
      if (stale()) return this.state;
      this.state = { kind: 'error', reason: 'read' };
      this.at = this.now();
      return this.state;
    }
  }

  /** 终态：作废在途读取，之后的 refresh 不再改状态。 */
  close() {
    this.closed = true;
    this.generation += 1;
  }
}

/** 验收用的账本路径覆盖：只在有效期内、且指向临时目录时生效；
 *  其它遗留值一律返回 null，不让测试路径影响真实运行。 */
export function fixturePath(raw, now = Date.now()) {
  if (typeof raw !== 'string' || !raw) return null;
  let v;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v.path !== 'string' || typeof v.until !== 'number') return null;
  if (v.until <= now) return null;
  const p = v.path;
  if (!p.startsWith('/tmp/') && !p.startsWith('/private/tmp/')) return null;
  return p;
}




const fnv = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

/** 发布签名：把 kind/数量/内容一起算成短哈希，条数不变但行内容变了也会变。
 *  只比较签名，不把正文写进日志或持久化。 */
export function ledgerSignature(state) {
  const rows = Array.isArray(state?.rows) ? state.rows : [];
  const parts = [state?.kind ?? '', String(state?.count ?? 0), state?.reason ?? ''];
  for (const r of rows) {
    // 面板会显示这些字段，任何一个变了都要重新发布。
    parts.push(r?.what ?? '', r?.impact ?? '', r?.proposedAt ?? '', r?.where ?? '', r?.project ?? '', r?.done ? '1' : '0');
  }
  return `${state?.kind ?? ''}:${state?.count ?? 0}:${rows.length}:${fnv(parts.join('\u0001'))}`;
}

/** 面板取状态：shared 与本地读取谁的时间新用谁；hidden 视为没有本地状态。 */
export function pickState(sharedState, ownState) {
  const sh = sharedState && typeof sharedState === 'object' ? sharedState : null;
  const own = ownState && ownState.kind && ownState.kind !== 'hidden' ? ownState : null;
  if (!sh) return own;
  if (!own) return sh;
  return (Number(own.at) || 0) >= (Number(sh.at) || 0) ? own : sh;
}



/** 当前 Space 可见的待批行：全局（空格子）恒显示；本 Space 精确匹配；
 *  明确属于别的现存 Space 才隐藏；匹配不到（改名/删除/未登记）按全局处理，绝不静默隐藏。 */
export function rowsForSpace(rows, space, knownSpaces = []) {
  const list = Array.isArray(rows) ? rows : [];
  const name = typeof space?.name === 'string' ? space.name.trim() : '';
  const id = typeof space?.id === 'string' ? space.id.trim() : '';
  const known = new Set();
  for (const s of Array.isArray(knownSpaces) ? knownSpaces : []) {
    if (typeof s?.name === 'string' && s.name.trim()) known.add(s.name.trim());
    if (typeof s?.id === 'string' && s.id.trim()) known.add(s.id.trim());
  }
  return list.filter((r) => {
    const at = String(r?.space ?? '').trim();
    if (!at) return true;
    if ((name && at === name) || (id && at === id)) return true;
    if (known.has(at)) return false;
    return true;
  });
}

/** 某个 Space 的待批面板（mod pane）：只认该 Space 的 tab，避免跨 Space 误伤。 */
export function pickApprovalsPane(panes, tabs, mod = 'workbench-tabs') {
  const ids = new Set((Array.isArray(tabs) ? tabs : []).map(t => t && t.id));
  return (Array.isArray(panes) ? panes : []).find(p => p && p.mod === mod && ids.has(p.tab)) ?? null;
}

/** chip 是否要渲染：hidden/empty 完全不渲染（不占位）；缺失与错误要露出待批 ?。 */
export function chipNode(state) {
  return chipState(state).kind !== 'hidden';
}

/** 全局行数（未处理且没有 Space 标记），用于 chip tooltip 的“含全局 N”。 */
export function globalCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && !r.done && !String(r.space ?? '').trim()).length;
}


/** 按类型给出动作集合：授权=批准/拒绝/稍后；选择=按建议/选其它/都不行/稍后。 */
export function rowActions(type) {
  if (type === '选择') return ['suggest', 'other', 'none', 'later'];
  return ['approve', 'reject', 'later'];
}

const DECISION_TEXT = {
  approve: '批准',
  reject: '拒绝',
  suggest: '按建议',
  none: '都不行',
  later: '稍后',
};

/** 给监督者的决定事件：PENDING-DECISION｜key｜类型｜决定｜ISO｜标题｜项目。
 *  只发消息，不写账本；选其它带序号（other:1/other:2）。 */
export function decisionEvent(row, decision, now = Date.now()) {
  const key = rowKey(row);
  const type = row?.type === '选择' ? '选择' : '授权';
  let text = DECISION_TEXT[decision] ?? String(decision ?? '');
  if (typeof decision === 'string' && decision.startsWith('other')) {
    const n = decision.split(':')[1] ?? '1';
    text = `选其它:${n}`;
  }
  const at = new Date(now).toISOString();
  const clean = v => String(v ?? '').replace(/[｜\n\r]/g, ' ').slice(0, 120);
  const title = clean(row?.what).slice(0, 80);
  return `PENDING-DECISION｜${key}｜${type}｜${text}｜${at}｜${title}｜${clean(row?.project)}`;
}






/** chip 正文：只给数字或 ?；隐藏态返回空串（chip 不渲染）。 */
export function chipLabel(state) {
  const s = chipState(state);
  if (s.kind === 'hidden') return '';
  if (s.kind === 'missing' || s.kind === 'error') return '?';
  return String(s.count);
}

/** 标签栏只渲染未收起的标签；顺序不变。 */
export function filterVisibleTabs(tabs) {
  return (Array.isArray(tabs) ? tabs : []).filter(t => t && !t.settled);
}

/** 每个 Space 一个待批标签：本 mod pane 且名为「待批」才算；pane 未知时不动作。 */
export function ensurePlan(tabs, panes) {
  const all = Array.isArray(tabs) ? tabs : [];
  const list = Array.isArray(panes) ? panes : [];
  const paneOf = id => list.find(p => p && p.tab === id);
  const named = all.filter(t => t && t.name === '待批');
  const ours = named.filter(t => paneOf(t.id)?.mod === 'workbench-tabs');
  if (ours.length) return { kind: 'exists', tab: ours[0].id, extras: ours.length - 1 };
  if (named.length) return { kind: 'wait' };
  return { kind: 'create' };
}

/** 0 条：非激活收起、激活只提示；>0：已收起则展开，否则保持。 */
export function settlePlan({ count, active, settled } = {}) {
  if (Number(count) > 0) return settled ? 'unsettle' : 'keep';
  return active ? 'banner' : 'settle';
}

/** chip 点击目标：只认 pane.mod 是本 mod 的待批标签；不做名字兜底。 */
export function chipTarget({ panes, tabs } = {}) {
  const ids = new Set((Array.isArray(tabs) ? tabs : []).map(t => t && t.id));
  const hit = (Array.isArray(panes) ? panes : []).find(p => p && p.mod === 'workbench-tabs' && ids.has(p.tab));
  return hit ? hit.tab : null;
}

/** 新建待批标签的参数：focus:false，绝不抢当前视图。 */
export function createArgs({ name = '待批', mod = 'workbench-tabs' } = {}) {
  return { name, mod, props: { approvals: true }, focus: false };
}

/** 老 build 不认识 focus 参数时的兜底：不带 focus，由调用方把焦点切回来。 */
export function legacyCreateArgs({ name = '待批', mod = 'workbench-tabs' } = {}) {
  return { name, mod, props: { approvals: true } };
}

/** 创建待批标签两次都失败时的状态：复位 creating、给出可见错误与一行诊断（不含账本正文）。 */
export function createFailure({ spaceId, error, now = Date.now() } = {}) {
  const msg = String(error?.message ?? error ?? 'unknown').split('\n')[0].slice(0, 80);
  return {
    creating: false,
    createError: `没能创建待批标签：${msg}`,
    logLine: `${new Date(now).toISOString()} space=${spaceId ?? '?'} error=${msg}`,
  };
}

/** 清理：只处理「名为待批 + pane.mod 是本 mod」的标签；keep 取最早；active 重复项先切 keep。
 *  唯一标签只有在 count===0 且非激活时才收起。pane 未知的同名标签不动作。 */
export function cleanupPlan(tabs, panes, count) {
  const all = Array.isArray(tabs) ? tabs : [];
  const list = Array.isArray(panes) ? panes : [];
  const paneOf = id => list.find(p => p && p.tab === id);
  const ours = all.filter(t => t && t.name === '待批' && paneOf(t.id)?.mod === 'workbench-tabs');
  if (!ours.length) return { keep: null, close: [], settle: [], select: [] };
  const keepTab = ours[0];
  const others = ours.slice(1);
  const close = others.map(t => t.id);
  const select = others.some(t => t.active) ? [keepTab.id] : [];
  const settle = [];
  if (all.length === 1 && Number(count) === 0 && !keepTab.active && !keepTab.settled) settle.push(keepTab.id);
  return { keep: keepTab.id, close, settle, select };
}

/** 清理日志一行：保留 id、被关的 id 列表、被收起的数量。 */
export function cleanupLogLine({ spaceId, plan, now = Date.now() } = {}) {
  const closed = (plan?.close ?? []).join(',');
  return `${new Date(now).toISOString()} space=${spaceId ?? '?'} keep=${plan?.keep ?? '-'} closed=${closed || '-'} settled=${(plan?.settle ?? []).length}`;
}

/** 有界重试：同一 id 最多 2 次，间隔 ≥30 秒；用完返回 giveup。 */
export function retryPlan({ tries = 0, lastAt = 0, now = Date.now(), max = 2, gap = 30000 } = {}) {
  if (Number(tries) >= max) return 'giveup';
  if (Number(tries) > 0 && now - Number(lastAt) < gap) return 'wait';
  return 'run';
}

/** 清理失败日志行：action/id/错误首行，不含账本正文。 */
export function cleanupFailureLine({ action, id, error, now = Date.now() } = {}) {
  const msg = String(error?.message ?? error ?? 'unknown').split('\n')[0].slice(0, 100);
  return `${new Date(now).toISOString()} action=${action ?? '?'} id=${id ?? '?'} error=${msg}`;
}

/** 一个 Space 的轮询决策（纯函数）：是否新建、收起/展开哪些、清理计划。
 *  只有当前 Space 才 ensure 新建；其余 Space 只做清理。 */
export function spacePlan({ tabs, panes, count, isActive } = {}) {
  const all = Array.isArray(tabs) ? tabs : [];
  const list = Array.isArray(panes) ? panes : [];
  const ens = ensurePlan(all, list);
  const out = { ensure: 'none', tab: ens.tab ?? null, settle: [], unsettle: [], cleanup: cleanupPlan(all, list, count) };
  if (isActive && ens.kind === 'create') out.ensure = 'create';
  if (isActive && ens.kind === 'exists') {
    const tab = all.find(t => t.id === ens.tab);
    const p = settlePlan({ count, active: tab?.active === true, settled: tab?.settled === true });
    if (tab && p === 'settle') out.settle.push(tab.id);
    if (tab && p === 'unsettle') out.unsettle.push(tab.id);
  }
  return out;
}

/** 预建/按需创建参数：带 space、focus:false，不抢视图。 */
export function createArgs2({ space, name = '待批', mod = 'workbench-tabs' } = {}) {
  return { space, name, mod, props: { approvals: true }, focus: false };
}

/** 红点：仅 count>0。 */
export function tabDot(count) {
  return Number(count) > 0;
}

/** 启动闸门：首次读账本已结束且已过 grace 才放行。 */
export function readyGate({ startedAt = 0, firstReadAt = null, now = Date.now(), grace = 2000 } = {}) {
  if (firstReadAt == null) return false;
  return now - Math.max(startedAt, firstReadAt) >= grace;
}

/** 该 Space 可见的未处理行签名（不含 Space 名、不含已处理行）。 */
export function spaceSignature({ rows, space, knownSpaces = [] } = {}) {
  const mine = rowsForSpace(rows, space, knownSpaces).filter(r => r && !r.done);
  if (!mine.length) return '';
  const parts = [];
  for (const r of mine) parts.push(r.what ?? '', r.impact ?? '', r.where ?? '', r.project ?? '', r.proposedAt ?? '', r.type ?? '');
  return fnv(parts.join('\u0001'));
}

/** 关闭标记：签名相同且有条目 → 保留；0 条/签名变/force → 清。 */
export function markerPlan({ marker, signature, count, force } = {}) {
  if (!marker || !marker.signature) return { keep: false };
  if (force) return { keep: false };
  if (Number(count) === 0) return { keep: false };
  if (marker.signature !== signature) return { keep: false };
  return { keep: true };
}

/** 我们创建过的 tab id 环形缓冲（有界）。 */
export function createdRing(prev, id, max = 20) {
  const list = (Array.isArray(prev) ? prev : []).concat(id ? [id] : []);
  return list.slice(-max);
}

/** 侧栏请求：TTL 内有效，过期丢弃。 */
export function requestPlan({ request, now = Date.now(), ttl = 10000 } = {}) {
  if (!request || typeof request !== 'object') return null;
  if (!request.space || !request.at) return null;
  if (now - Number(request.at) > ttl) return null;
  return request;
}

/** 三路分流：prebuild / ensure / force；已存在时 N>0 且 settled 返回 unsettle。 */
export function creationPlan({ tabs, panes, count, mode, markerKeep, } = {}) {
  const all = Array.isArray(tabs) ? tabs : [];
  const list = Array.isArray(panes) ? panes : [];
  const paneOf = id => list.find(p => p && p.tab === id);
  const named = all.filter(t => t && t.name === '待批');
  const ours = named.filter(t => paneOf(t.id)?.mod === 'workbench-tabs');
  if (ours.length) {
    const tab = ours[0];
    if (Number(count) > 0 && tab.settled) return 'unsettle';
    return 'none';
  }
  if (named.length) return 'wait';
  if (markerKeep) return 'none';
  if (mode === 'force' || mode === 'prebuild') return 'create';
  return Number(count) > 0 ? 'create' : 'none';
}
