// 后台子 agent：无 pane、父在本 Space、live 的 terminal；只读，不写标签。
export function backgroundName(terminal) {
  const named = terminal?.labels?.['workbench.name'];
  if (named) return String(named);
  if (terminal?.name) return String(terminal.name);
  const argv = terminal?.argv ?? terminal?.foreground?.argv ?? [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name' && argv[i + 1]) return String(argv[i + 1]);
    if (typeof argv[i] === 'string' && argv[i].startsWith('--name=')) return argv[i].slice(7);
  }
  return terminal?.address ?? '';
}

export function backgroundStatus(terminal) {
  const status = terminal?.status;
  if (typeof status === 'string') return status || null;
  return status?.state ?? null;
}

// 后台行展示：第一行程序名、第二行任务名；父名只进 tooltip，不用 ↳ 顶替。
export function backgroundRow(terminal, parentName, parentProgram = null) {
  // terminals() 的 program 只有 name；图标以父 agent 的 program 为准。
  const icon = parentProgram?.icon ?? terminal?.program?.icon ?? null;
  const tint = Boolean(parentProgram?.tint ?? terminal?.program?.tint);
  return {
    icon,
    tint,
    program: terminal?.program?.name ?? parentProgram?.name ?? 'Agent',
    name: backgroundName(terminal),
    tooltip: parentName ? `后台 · 父 Agent：${parentName}` : '后台子 agent',
  };
}

// 只返回可直接渲染的后台行；父已在 agents() 里且同 Space，terminal 自己没有 pane。
export function backgroundRows(terminals, agents, spaceId, panes = []) {
  const list = Array.isArray(terminals) ? terminals : [];
  const normal = Array.isArray(agents) ? agents : [];
  const byAddress = new Map(normal.map(a => [a.address, a]));
  const paneTerms = new Set((panes ?? []).map(p => p?.terminal).filter(Boolean));
  const parentOrder = new Map(normal.filter(a => a.space === spaceId).map((a, i) => [a.address, i]));
  const rows = [];
  for (const t of list) {
    if (!t || t.state !== 'live' || !t.address || !t.parent) continue;
    if (byAddress.has(t.address) || paneTerms.has(t.address)) continue;
    const parent = byAddress.get(t.parent);
    if (!parent || parent.space !== spaceId) continue;
    rows.push({
      ...t,
      background: true,
      name: backgroundName(t),
      status: backgroundStatus(t),
      parentName: parent.name ?? parent.program?.name ?? t.parent,
    });
  }
  rows.sort((a, b) => (parentOrder.get(a.parent) ?? Infinity) - (parentOrder.get(b.parent) ?? Infinity)
    || a.name.localeCompare(b.name, 'zh')
    || a.address.localeCompare(b.address));
  return rows;
}

// 点击后台行：有 focused pane 时临时显示；否则用 peek 看，不新建 pane。
export function backgroundAction(terminal, hasFocusedPane) {
  if (!terminal?.address) return null;
  return hasFocusedPane
    ? { name: 'terminal.show', args: { terminal: terminal.address } }
    : { name: 'terminal.peek', args: { terminal: terminal.address } };
}

// 有 shown 时，原 pane 所属普通行不再算选中；拖动行仍保留抓取高亮。
export function rowSelected(agent, shown, moved = false) {
  return Boolean(moved || (agent?.focused && !shown));
}
