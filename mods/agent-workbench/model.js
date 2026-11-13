// 工作台纯逻辑：只使用明确命名和共享排序，不读取对话正文。
export function taskName(agent, labels) {
  return labels['workbench.name'] || agent.program?.name || 'Agent';
}
export function validateName(name, siblings) {
  if (!name.trim()) return '请输入简短任务名';
  if ([...name.trim()].length > 16) return '任务名请控制在 16 字以内';
  if (siblings.includes(name.trim())) return '当前 Space 已有同名任务';
  return null;
}
export function ordered(list, ranks) {
  return [...list].sort((a,b) => (Number(ranks[a.address] ?? Infinity) - Number(ranks[b.address] ?? Infinity)));
}
export function reorder(ids, address, index) {
  if (!ids.includes(address)) return [...ids];
  const next=ids.filter(id=>id!==address);
  next.splice(Math.max(0,Math.min(index,next.length)),0,address);
  return next;
}
// 最近会话的动作：只有明确的 recent 才整行恢复，failed 只给显式新建入口。
export function recentAction(record) {
  if(record?.state==='recent') return 'restore';
  if(record?.state==='failed') return 'fresh';
  return 'none';
}
// 删除一条最近会话记录：只改本地快照，不杀进程、不动原会话。
export function dropRecent(history, key) {
  const src=history??{};
  if(!Object.hasOwn(src,key)) return src;
  const next={...src};
  delete next[key];
  return next;
}
// 恢复失败弹窗：原因原话保留；取消不产生任何状态写入。
export function failurePrompt(reason) {
  return {title:'无法恢复原会话',reason: reason||'未获取到可验证的原会话 ID，无法恢复上下文',
    actions:[{id:'fresh',label:'新建对话',primary:true},{id:'dismiss',label:'删除记录',primary:false}]};
}
// 只有明确选择才执行；取消或未知动作返回 null 且不调用任何处理器。
export function dispatchFailure(action, handlers={}) {
  const fn=action==='fresh'?handlers.fresh:action==='dismiss'?handlers.dismiss:null;
  return typeof fn==='function'?fn():null;
}
// tab 改名计划：该 tab 只有这一个终端、且名字确实要变时才返回参数。
// 共用 tab 返回 null，调用方不得改名，避免覆盖别人的 tab 名。
export function tabSyncPlan(panes, agent, name) {
  const tab=agent?.tab;
  if(!tab||!name||agent.tab_name===name) return null;
  const inTab=(panes??[]).filter(p=>p?.tab===tab&&p?.terminal);
  if(inTab.length!==1||inTab[0].terminal!==agent.address) return null;
  return {id:tab,name};
}
// 终端区：只收本 Space、live、没有 agent 状态、且有 pane 的终端；只读，不写标签。
export function spaceTerminals(terminals, agents, panes, spaceId) {
  const agentAddrs=new Set((agents??[]).map(a=>a?.address));
  const paneTerms=new Set((panes??[]).map(p=>p?.terminal).filter(Boolean));
  return (terminals??[]).filter(t=>t?.address&&t.state==='live'&&t.labels?.['herdr.space']===spaceId&&!agentAddrs.has(t.address)&&paneTerms.has(t.address));
}
export function terminalName(terminal) {
  const labels=terminal?.labels??{};
  return labels['workbench.name']||terminal?.name||terminal?.title||terminal?.address||'终端';
}
// 每个 Space 直接显示 limit 条，其余收进「还有 N 条」；展开态由调用方按 Space 记。
export function terminalRows(list, expanded, limit=3) {
  const all=Array.isArray(list)?list:[];
  const shown=expanded?all:all.slice(0,limit);
  return {shown,more:Math.max(0,all.length-shown.length)};
}
// 只有重名才在行尾补地址，避免每行都挂一个地址。
export function duplicateNames(list) {
  const count=new Map();
  for(const t of list??[]){const n=terminalName(t);count.set(n,(count.get(n)??0)+1);}
  return new Set([...count].filter(([,c])=>c>1).map(([n])=>n));
}
// 折叠状态持久化：{spaceId:true}；坏 JSON、未知结构、非 true 值都静默忽略。
export function parseFoldState(raw) {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [key, value] of Object.entries(obj)) if (value === true) out[key] = true;
    return out;
  } catch {
    return {};
  }
}
export function serializeFoldState(folded) {
  const out = {};
  for (const id of folded ?? []) out[id] = true;
  return JSON.stringify(out);
}
export function foldedFrom(obj) {
  return new Set(Object.entries(obj ?? {}).filter(([, value]) => value === true).map(([key]) => key));
}
// 终端小节折叠：按 Space 记，返回新集合，不就地修改原状态。
export function toggleTerminalFold(folded, spaceId) {
  const next = new Set(folded ?? []);
  if (next.has(spaceId)) next.delete(spaceId);
  else next.add(spaceId);
  return next;
}
// 折叠时一条终端行都不渲染，也不显示「还有 N 条」。
export function terminalSectionRows(list, { folded = false, expanded = false, limit = 3 } = {}) {
  if (folded) return { shown:[], more:0, folded:true };
  const { shown, more } = terminalRows(list, expanded, limit);
  return { shown, more, folded:false };
}
// 终端小节标题与计数分开，避免「终端 3」被读成编号。
export function terminalSection(count) {
  return {title:'终端',count:Math.max(0,Number(count)||0)};
}
// 指针是否还在侧栏内：轮询用坐标兜底，不依赖 hover/move 事件。
export function pointerInBounds(point, bounds) {
  if(!point||!bounds) return false;
  return point.x>=bounds.x&&point.y>=bounds.y&&point.x<bounds.x+bounds.width&&point.y<bounds.y+bounds.height;
}
// 小位移阈值：不超过阈值的按下按单击处理，不算拖动。
export function isDragMove(dy, threshold = 4) {
  return Math.abs(Number(dy)) > threshold;
}
// 拖动终态决策：focus 不写标签；cancel 不动作；只有 reorder 落顺序。
export function dragOutcome(d, threshold = 4) {
  if(!d) return 'none';
  // 首/末行会把 dy 夹紧到 0；4px 阈值必须看未夹紧的指针位移。
  if(!isDragMove(d.rawDy ?? d.dy ?? 0, threshold)) return 'focus';
  if(!d.valid) return 'cancel';
  return d.target !== d.index ? 'reorder' : 'noop';
}
// 拖动位移换算目标行：只取整和夹紧，指针坐标由调用方换成 dy。
export function dragTarget(index, dy, row, count) {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index + Math.round(dy / row)));
}
export function classify(terminal, reported) {
  if (!terminal || terminal.state !== 'live') return 'interrupted';
  return reported ? 'active' : 'closed';
}
// 会话身份包含进程代次，防止在同一 shell 重启 Agent 时覆盖历史。
export function recordKey(address, labels={}) {
  return address+':'+(labels['workbench.pid']??'initial')+':'+(labels['workbench.session']||'pending');
}
export function recovery(record, live=false) {
  if (live) return {state:'live',reason:'原会话仍在运行，请直接打开'};
  if(record.verified&&/^[0-9a-f-]{36}$/i.test(record.sessionId??'')) {
    if(record.program==='codex')return {state:'ready',argv:['codex','--no-daemon','resume',record.sessionId]};
    if(record.program==='dsh-tui')return {state:'ready',argv:['dsh-tui','--resume',record.sessionId]};
    if(record.program==='claude')return {state:'ready',argv:['claude','--resume',record.sessionId]};
  }
  if(record.verified&&record.program==='opencode'&&/^ses_[a-zA-Z0-9]+$/.test(record.sessionId??''))return {state:'ready',argv:['opencode','--session',record.sessionId]};
  return {state:'failed',reason: record.sessionId
    ? '该 Agent 的恢复成功信号尚未通过验证'
    : '未获取到可验证的原会话 ID，无法恢复上下文'};
}
