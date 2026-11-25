// 每个终端单独保存本轮显示状态，阅读期限只在首次查看时设置。
export function completionIcon(state, {status, now, focused, packet}) {
  const revision = packet?.parentRevision;
  const fresh = revision != null && revision !== state.revision;
  if (revision != null) state.revision = revision;
  const previous = state.status;
  state.status = status;
  if (status === 'working') {
    state.phase = 'working';
    state.deadline = null;
  } else if (status === 'error' || status === 'blocked' || packet?.parentState === 'blocked') {
    state.phase = 'blocked';
    state.deadline = null;
  } else if ((['done','completed'].includes(status) && previous !== status) ||
      (packet?.parentState === 'completed' && (fresh || !state.phase))) {
    if (state.phase !== 'completed' && (state.phase !== 'read' || fresh)) {
      state.phase = 'completed';
      state.deadline = null;
    }
  } else if (status === 'idle' && state.phase !== 'completed') {
    state.phase = 'idle';
  }
  if (state.phase === 'completed' && focused) state.deadline ??= now + 60000;
  if (state.deadline != null && now >= state.deadline) {
    state.phase = 'read';
    state.deadline = null;
  }
  return state.phase === 'read' ? 'idle' : state.phase ?? 'idle';
}
