// 侧栏机器视图：Space 按机器分组，跨机待办计数。
// 纯逻辑，不依赖 herdr/gpui；可用 fixture 测试。
//
// 规则：
// - 本机（machine === null）单独成组，不与远端同名 Space 合并。
// - 远端机器按机器名分组，组内 Space 保持传入顺序。
// - 空 Space（没有 Agent）仍然保留，但计数为 0。
// - 远端机器离线（machine 列表里标为不可达）时保留分组，计数照旧。
// - 同名 Space 靠 ID 归属，不按名字合并。

// 本机组固定用 null 表示；远端用机器名。
const LOCAL = null;

// 机器显示顺序：本机优先，其余按传入顺序，去重。
export function machineNames(spaces = [], offline = []) {
  const names = [];
  const seen = new Set();
  for (const s of spaces ?? []) {
    const name = s?.machine ?? LOCAL;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  for (const name of offline ?? []) {
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

// 建立侧栏索引：机器 -> Space -> Agent；以及每个机器的待办计数。
// items：address -> 待办条目数组（仅统计需要用户处理的状态）。
export function sidebarIndex(spaces = [], agents = [], items = new Map()) {
  const spaceById = new Map();
  for (const s of spaces ?? []) spaceById.set(s.id, s);

  const members = new Map();   // space id -> Agent 列表
  const pending = new Map();   // 机器名 -> 待办计数
  const spacesByMachine = new Map(); // 机器名 -> Space 列表

  for (const s of spaces ?? []) {
    const machine = s.machine ?? LOCAL;
    if (!spacesByMachine.has(machine)) spacesByMachine.set(machine, []);
    spacesByMachine.get(machine).push(s);
    if (!members.has(s.id)) members.set(s.id, []);
  }

  for (const a of agents ?? []) {
    if (!members.has(a.space)) {
      // Agent 的 Space 还没出现在 spaces() 里：按 ID 兜底归属，本机优先。
      const machine = String(a.address ?? '').includes('/') ? String(a.address).split('/')[0] : LOCAL;
      if (!spacesByMachine.has(machine)) spacesByMachine.set(machine, []);
      members.set(a.space, []);
    }
    members.get(a.space).push(a);
  }

  for (const [machine, list] of spacesByMachine) pending.set(machine, 0);

  for (const [address, list] of items ?? new Map()) {
    const count = (list ?? []).length;
    if (!count) continue;
    const machine = machineOfAddress(address, spaceById, members);
    pending.set(machine, (pending.get(machine) ?? 0) + count);
  }

  return { members, pending, spacesByMachine };
}

// Agent 地址形如 machine/terminal；本机没有前缀。
export function machineOfAddress(address, spaceById = new Map(), members = new Map()) {
  const text = String(address ?? '');
  if (text.includes('/')) return text.split('/')[0];
  for (const [spaceId, list] of members) {
    if ((list ?? []).some(a => a.address === address)) {
      const space = spaceById.get(spaceId);
      if (space) return space.machine ?? LOCAL;
    }
  }
  return LOCAL;
}
