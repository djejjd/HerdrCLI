// 侧栏头部：Herdr 字样 + 搜索 + 新建；替代原厂 workspace-chrome 的品牌行。
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, shared } from "herdr";
import { palette, mode } from "./palette.js";

export default class WorkbenchBrand extends View {
  render() {
    try { return this.view(); } catch (e) {
      return div().size_full().bg('#ffe9e9').px(10).child(div().text_size(11).text_color('#a00010').child(String(e && e.message || e).slice(0,200)));
    }
  }
  view() {
    const p = palette(mode(shared));
    const btn = (id, path, action) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(p.subtle).hover(s => s.bg(p.hover).text_color(p.ink))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action)
      .child(svg(path).size(14));
    return h_flex().size_full().bg(p.surface).pl(14).pr(8).gap(4).items_center()
      .child(div().text_size(15.5).font_semibold().text_color(p.ink).child('Herdr'))
      .child(div().flex_1())
      .child(btn("brand-new", "mods/workspace-chrome/plus.svg", () => run("space.new")));
  }
}
