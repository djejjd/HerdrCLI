// 机器用宿主名、项目用 Space ID，显示名相同不会串组。
export function machineNames(spaces, configured) {
  const remote = [...new Set([...spaces.map(s => s.machine), ...configured].filter(Boolean))];
  return remote.length ? [null, ...remote] : [];
}

export function sidebarIndex(spaces, agents, items, children = () => []) {
  const members = new Map(spaces.map(s => [s.id, []]));
  const perSpace = new Map(), pending = new Map(), seen = new Set();
  for (const agent of agents) {
    members.get(agent.space)?.push(agent);
    for (const a of [agent, ...children(agent)]) {
      if (seen.has(a.address)) continue;
      seen.add(a.address);
      const count = (items.get(a.address) ?? []).filter(item => item.displayState !== 'operation').length;
      perSpace.set(agent.space,(perSpace.get(agent.space) ?? 0) + (count || Number(a.status === 'blocked')));
    }
  }
  for (const s of spaces) {
    const key = s.machine ?? null;
    pending.set(key,(pending.get(key) ?? 0) + (perSpace.get(s.id) ?? 0));
  }
  return { members, perSpace, pending };
}

// 根据目标组的上、下半区计算移除源项后的插入位置，拒绝跨机或空操作。
export function spaceMove(spaces, sourceId, targetId, after) {
  const source = spaces.find(s => s.id === sourceId);
  const target = spaces.find(s => s.id === targetId);
  if (!source || !target || source === target || (source.machine ?? null) !== (target.machine ?? null)) return null;
  const siblings = spaces.filter(s => (s.machine ?? null) === (source.machine ?? null));
  const from = siblings.indexOf(source);
  const to = siblings.filter(s => s !== source).indexOf(target) + Number(after);
  return from === to ? null : { id:source.id, index:to + 1 };
}
