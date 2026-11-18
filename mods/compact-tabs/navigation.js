// 计算可见集合；固定项优先，其余项保持工作区内的相对位置。
export function partition(tabs, pins, recent, capacity) {
  const live = new Set(tabs.map(tab => tab.id));
  const active = tabs.find(tab => tab.active)?.id;
  const priority = new Set([active, ...pins, ...recent, ...live].filter(id => live.has(id)));
  const keep = new Set([...priority].slice(0, Math.max(1, capacity)));
  return [...tabs.filter(tab => pins.includes(tab.id)), ...tabs.filter(tab => !pins.includes(tab.id))]
    .filter(tab => keep.has(tab.id));
}

export function taskName(stored, fallback) {
  return stored?.trim() || fallback?.replace(/^Action Required\s*[|｜]\s*/i, '').trim() || 'Terminal';
}

export function matches(fields, query) {
  return fields.some(field => String(field ?? '').toLowerCase().includes(query.trim().toLowerCase()));
}

// 每个标签按标题、工具图标和操作占位计宽。溢出时给箭头预留 30px。
export function fitTabs(tabs, pins, recent, widths, available) {
  const ordered = partition(tabs, pins, recent, tabs.length);
  const total = ordered.reduce((sum, tab) => sum + widths.get(tab.id), 0);
  if (total <= available) return ordered;
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  const priority = new Set([tabs.find(tab => tab.active)?.id, ...pins, ...recent, ...byId.keys()]);
  const keep = new Set();
  let left = available - 30;
  for (const id of priority) {
    if (!byId.has(id)) continue;
    const cost = widths.get(id);
    if (keep.size && cost > left) continue;
    keep.add(id);
    left -= cost;
  }
  return ordered.filter(tab => keep.has(tab.id));
}

export function menuOrder(tabs, previous) {
  const rank = tab => tab.active ? 0 : tab.id === previous ? 1 : 2;
  return [...tabs].sort((a,b) => rank(a) - rank(b));
}
