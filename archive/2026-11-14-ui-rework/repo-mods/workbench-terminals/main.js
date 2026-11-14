// 底部终端条（收起态）：终端 · N 个分屏 / 右：⌘T 新建分屏。照 g-v2.html 的 .dock-head 1:1。
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, shared } from "herdr";
import { palette, mode } from "./palette.js";

export default class WorkbenchTerminals extends View {
  render() {
    try { return this.view(); } catch (e) {
      return div().size_full().bg('#ffe9e9').px(10).child(div().text_size(11).text_color('#a00010').child(String(e && (e.message || e)).slice(0, 300)));
    }
  }
  view() {
    const p = palette(mode(shared));
    const space = spaces().find(s => s.active) ?? null;
    const tab = space?.tabs?.find(t => t.active) ?? null;
    const n = panes().filter(x => x.tab === tab?.id).length;
    return h_flex().size_full().bg(p.canvas).h(36).pl(10).pr(14).gap(8).items_center()
      .border_t_1().border_color(p.line)
      .child(div().w(12).flex().items_center().justify_center().child(svg('mods/workspace-chrome/chevron-right.svg').size(10).text_color(p.subtle)))
      .child(div().text_size(11.5).text_color(p.muted).child('终端'))
      .child(div().text_size(11.5).text_color(p.muted).child(`· ${n} 个分屏`))
      .child(div().flex_1())
      .child(div().text_size(10).text_color(p.subtle).bg(p.raised).rounded(4).px(4).py(1).child('⌘T'))
      .child(div().text_size(11).text_color(p.subtle).child('新建分屏'));
  }
}
