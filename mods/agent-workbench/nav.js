// 合并导航的纯逻辑：折叠与选择分离，空/仅 shell 的 Space 仍可进入。
export function toggleFold(folded, id) {
  const next = new Set(folded);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}
export function spaceSelectArgs(space) {
  return { id: space.id };
}
export function spaceHint(agentCount) {
  return agentCount === 0 ? '无 Agent' : null;
}
// 项目菜单上移/下移：只允许相邻、同一机器的项目；space.move 的 index 从 1 起。
export function moveSpace(spaces, id, delta) {
  const list = Array.isArray(spaces) ? spaces : [];
  const index = list.findIndex(space => space.id === id);
  if (index < 0) return null;
  const target = index + delta;
  if (target < 0 || target >= list.length) return null;
  if ((list[index].machine ?? null) !== (list[target].machine ?? null)) return null;
  return { id, index: target + 1 };
}
// 松手后的本地预览顺序：目标 ids 优先，未列出的新行保留在末尾。
export function applyOrder(list, ids) {
  const rank = new Map((ids ?? []).map((id, index) => [id, index]));
  return [...list].sort((a, b) => (rank.get(a.address) ?? Infinity) - (rank.get(b.address) ?? Infinity));
}
