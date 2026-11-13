// 标签栏侧栏开关：始终可见，只映射 layout.toggle，不另存布尔状态（与 cmd-b 同源）。
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}
export function sidebarToggle(tree) {
  const hidden = find(tree, 'sidebar')?.hidden === true;
  return {
    hidden,
    command: 'layout.toggle',
    args: { id: 'sidebar' },
    // 侧栏在左：可见时收起（朝左），隐藏时展开（朝右）。
    icon: hidden ? 'mods/workspace-chrome/chevron-right.svg' : 'mods/workspace-chrome/chevron-left.svg',
    label: hidden ? '展开侧栏' : '收起侧栏',
  };
}
