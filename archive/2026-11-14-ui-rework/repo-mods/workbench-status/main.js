// 底部状态栏：终端 · N 个分屏 ｜ This computer · 分支 · N agents（Settings/Add machine 已移入右上 ⋯ 菜单）
// 原厂 workspace-status 不可改，克隆一份；起点跟随侧栏实际宽度，收起时贴左。
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, panes, window, layout, shared } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class WorkbenchStatus extends View {
  render() {
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === 'blocked').length;
    const tab = space?.tabs?.find(t => t.active) ?? null;
    const n = panes().filter(x => x.tab === tab?.id).length;
    const item = (icon, text) => h_flex().gap(6).items_center()
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12).text_color('#a1a1a6'))
      .child(div().text_size(11.5).text_color('#5a5a5f').child(text));

    const side = find(layout(), 'sidebar');
    const px = side?.size?.px ?? shared('sidebar.width') ?? 268;
    const hidden = side?.hidden === true || side?.shown === false;
    const collapsed = hidden || px < 160;
    const sideW = collapsed ? (window()?.platform === 'macos' ? 76 : 44) : px;
    const start = collapsed ? 14 : sideW + 14;

    return h_flex().size_full().pr(14).items_center().bg('#f7f7f8')
      .border_t_1().border_color('#e3e3e6')
      .child(h_flex().flex_1().pl(start).gap(16).items_center()
        .child(item('terminal', collapsed ? `终端 · ${n}` : `终端 · ${n} 个分屏`))
        .child(item(space?.machine ? 'server' : 'monitor', space?.machine ?? 'This computer'))
        .when(Boolean(space?.branch), el => el.child(item('branch', space.branch)))
        .child(h_flex().gap(6).items_center()
          .child(div().size(6).rounded_full().bg('#a1a1a6'))
          .child(div().text_size(11.5).text_color('#5a5a5f').child(`${list.length} agents`))
          .when(needs > 0, el => el.child(div().text_size(11.5).text_color('#c4320a').child(`· ${needs} needs you`))))
        .child(div().flex_1()));
  }
}
