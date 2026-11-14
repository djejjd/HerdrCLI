// 面包屑（替代标签栏）：Space › 标签 ● 状态 / 右：⌘T 分屏 ⌘W 关闭 ⋯。照 g-v2.html 的 .crumb 1:1。
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, shared, run, openOverlay } from "herdr";
import { palette, mode } from "./palette.js";

const WORD = { working: '运行中', blocked: '需确认', done: '完成', idle: '待命' };
const DOT = { working: 'ok', blocked: 'warn', done: 'subtle', idle: 'subtle' };

export default class WorkbenchCrumb extends View {
  render() {
    try { return this.view(); } catch (e) {
      return div().size_full().bg('#ffe9e9').px(10).child(div().text_size(11).text_color('#a00010').child(String(e && (e.message || e)).slice(0, 300)));
    }
  }
  view() {
    const p = palette(mode(shared));
    const space = spaces().find(s => s.active) ?? null;
    const tab = space?.tabs?.find(t => t.active) ?? null;
    const st = tab?.status ?? null;
    const hint = (k, label) => h_flex().gap(4).items_center()
      .child(div().text_size(10).text_color(p.subtle).bg(p.raised).rounded(4).px(4).py(1).child(k))
      .child(div().text_size(11).text_color(p.subtle).child(label));
    return h_flex().size_full().bg(p.canvas).h(44).pl(10).pr(16).gap(7).items_center()
      .border_b_1().border_color(p.line)
      .child(h_flex().id('sb-toggle').size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(p.hover)).on_click(() => run('layout.toggle', { id: 'sidebar' }))
        .child(svg('mods/workspace-chrome/sidebar.svg').size(14).text_color(p.subtle)))
      .when(Boolean(space), e => e.child(div().text_size(12.5).text_color(p.muted).child(space.name)))
      .child(div().text_size(12).text_color(p.subtle).child('›'))
      .when(Boolean(tab), e => e.child(div().text_size(13).font_semibold().text_color(p.ink).child(tab.name)))
      .when(Boolean(st), e => e.child(h_flex().gap(4).items_center().ml(2)
        .child(div().size(5).rounded_full().bg(p[DOT[st]] || p.subtle))
        .child(div().text_size(11.5).text_color(p[DOT[st]] || p.subtle).child(WORD[st] || ''))))
      .child(div().flex_1())
      .child(hint('⌘T', '分屏'))
      .child(hint('⌘W', '关闭'))
      .child(h_flex().id('crumb-more').size(24).items_center().justify_center().rounded(6).cursor_pointer()
        .hover(e => e.bg(p.hover))
        .on_click(() => openOverlay({ mod: 'workbench-more', kind: 'popup', frame: 'none', at: 'pointer' }))
        .child(div().text_size(13).text_color(p.subtle).child('⋯')));
  }
}
