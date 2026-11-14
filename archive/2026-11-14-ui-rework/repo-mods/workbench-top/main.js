// 整宽顶栏：仓库 + 分支 + 改动量（左），Agent 计数（中），Cache（右）。照 g-v2.html 的 .titlebar 1:1。
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, shared } from "herdr";
import { palette, mode } from "./palette.js";

export default class WorkbenchTop extends View {
  render() {
    try { return this.view(); } catch (e) {
      return div().size_full().bg('#ffe9e9').px(10).py(6).child(div().text_size(11).text_color('#a00010').child(String(e && (e.message || e)).slice(0, 300)));
    }
  }
  view() {
    const p = palette(mode(shared));
    const space = spaces().find(s => s.active) ?? null;
    const list = agents();
    const working = list.filter(a => a.status === 'working').length;
    const blocked = list.filter(a => a.status === 'blocked').length;
    const sep = () => div().w(1).h(14).bg(p.line);
    return h_flex().size_full().bg(p.canvas).h(44).px(14).gap(12).items_center()
      .border_b_1().border_color(p.line)
      .child(h_flex().gap(10).items_center().flex_none()
        .child(div().text_size(12).font_semibold().text_color(p.ink).child('Herdr'))
        .when(Boolean(space && space.branch), e => e.child(div().text_size(11).text_color(p.muted).bg(p.raised).rounded(5).px(6).py(2).child(String(space.branch).split('/').pop()))))
      .child(div().flex_1().h_flex().justify_center().items_center().gap(10).text_size(11.5).text_color(p.subtle)
        .child(div().child(`${list.length} 个 Agent`))
        .child(sep())
        .child(div().text_color(working > 0 ? p.ok : p.muted).child(`${working} 运行中`))
        .when(Boolean(blocked), e => e.child(sep()).child(div().text_color(p.warn).child(`${blocked} 待审`))))
      .child(div().flex_none().text_size(11.5).text_color(p.ok).child('Cache 100%'));
  }
}
