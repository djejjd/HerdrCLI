// 限制项目导航高度，余下区域交给 Agents。
export function spacesHeight(count, machines) {
  return Math.min(300, 48 + count * 30 + 38 + Math.max(0, machines - 1) * 28);
}
