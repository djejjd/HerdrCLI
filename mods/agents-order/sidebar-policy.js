// 展开时限制可拖动宽度，折叠时固定窄栏。
export function toggleWidth(current,saved,rail) {
  return current < 160 ? {min:240,px:Math.min(480,Math.max(240,saved || 268))} : {min:rail,px:rail};
}
export function statusText(state) {
  return {working:'运行中',permission:'待授权',reply:'待回应',review:'待审核',idle:'空闲',blocked:'阻塞',completed:'本轮已完成'}[state] || '状态未知';
}

// 父方在本终端确认临时子项的完成版本，父身份变化、接管或恢复时重新展示。
export function visibleChildren(rows, receipt, terminal, snapshot) {
  if (typeof receipt !== 'string' || receipt.length > 8192 || typeof snapshot?.identity !== 'string' || !snapshot.identity
    || !Array.isArray(snapshot.children) || (snapshot.stage && snapshot.stage !== 'ready')) return rows;
  let seen;
  try { seen = JSON.parse(receipt); } catch { return rows; }
  const parent = seen?.parent;
  if (seen?.version !== 1 || !parent || !seen.received || typeof seen.received !== 'object' || Array.isArray(seen.received)
    || !terminal || parent.address !== terminal.address
    || parent.createdMs !== terminal.created_ms || parent.pid !== terminal.foreground?.pid
    || parent.pid !== snapshot.pid || parent.identity !== snapshot.identity) return rows;
  return rows.filter(kid => {
    if (kid.state !== 'completed' || !Number.isSafeInteger(kid.revision) || kid.revision <= 0
      || !Object.hasOwn(seen.received,kid.id) || seen.received[kid.id] !== kid.revision) return true;
    const matches = snapshot.children.slice(0,16).filter(item => item?.id === kid.id);
    const lifecycle = matches[0]?.lifecycle;
    return matches.length !== 1 || (lifecycle != null && (lifecycle.kind !== 'temporary'
      || ['pending','takeover','recovering'].some(key => lifecycle[key] != null && lifecycle[key] !== false)));
  });
}
