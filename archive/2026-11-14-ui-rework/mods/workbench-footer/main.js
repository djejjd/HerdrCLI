// 侧栏底部：更新提示 + Settings + Add machine。照 g-v2.html 的 .sfoot 1:1。
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, updates } from "herdr";

export default class WorkbenchFooter extends View {
  render() {
    try { return this.view(); } catch (e) {
      return div().size_full().bg('#ffe9e9').px(10).child(div().text_size(11).text_color('#a00010').child(String(e && (e.message || e)).slice(0, 200)));
    }
  }
  row(id, label, action) {
    return h_flex().id(id).h(30).px(16).gap(9).items_center().cursor_pointer()
      .text_size(13).text_color('#333336').hover(s => s.bg('#f2f2f4'))
      .on_click(action).child(label);
  }
  view() {
    const ready = updates()?.app?.ready;
    return v_flex().size_full().bg('#f7f7f8').border_t_1().border_color('#e3e3e6').pt(4).pb(6)
      .when(Boolean(ready), e => e
        .child(h_flex().id('upd').h(30).px(16).items_center().gap(7)
          .child(div().size(6).rounded_full().bg('#0066cc'))
          .child(div().text_size(13).text_color('#333336').child(`有新版本 ${ready}`))
          .child(div().flex_1())
          .child(div().text_size(12).text_color('#0066cc').cursor_pointer().on_click(() => run('app.check_updates')).child('查看'))))
      .child(this.row('settings', h_flex().gap(9).items_center()
        .child(svg('mods/workspace-chrome/settings.svg').size(14).text_color('#5a5a5f'))
        .child(div().child('Settings')), () => run('app.settings')))
      .child(this.row('machine', h_flex().gap(9).items_center()
        .child(svg('mods/workspace-chrome/plus.svg').size(14).text_color('#5a5a5f'))
        .child(div().child('Add machine')), () => run('mod.open', { name: 'machine-add' })));
  }
}
