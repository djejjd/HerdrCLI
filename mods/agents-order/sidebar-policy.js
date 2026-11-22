// 展开时限制可拖动宽度，折叠时固定窄栏。
export function toggleWidth(current,saved,rail) {
  return current < 160 ? {min:240,px:Math.min(480,Math.max(240,saved || 268))} : {min:rail,px:rail};
}
export function statusText(state) {
  return {working:'运行中',permission:'待授权',reply:'待回应',review:'待审核',idle:'空闲',blocked:'阻塞',completed:'本轮已完成'}[state] || '状态未知';
}

// 父方在本终端确认临时子项的完成版本，恢复或新一轮完成后重新展示。
export function visibleChildren(rows, receipt) {
  let seen;
  try { seen = JSON.parse(receipt || '{}'); } catch { return rows; }
  return rows.filter(kid => !(kid.state === 'completed' && Number.isSafeInteger(kid.revision) && seen?.[kid.id] === kid.revision));
}
