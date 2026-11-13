// toast 路由纯函数：agent 介入通知交给右下角浮层，官方 toast 不再重复显示。
export function shouldSwallowToast(p) {
  if (!p || typeof p !== 'object') return false;
  const target = p.action?.args?.terminal ?? p.action?.args?.pane;
  if (!target) return false;
  if (p.action?.name === 'agent.focus' || p.action?.name === 'pane.focus') return true;
  return ['blocked', 'error', 'done'].includes(p.level);
}
