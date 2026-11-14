// 「⋯」菜单：收纳 Settings / Add machine 等入口，避免挤占底部状态栏。
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, closeOverlay, props } from "herdr";

const mono = (s) => div().text_size(11).font_family('Menlo').text_color(theme().dim).child(s);

export default class MoreMenu extends View {
  render() {
    const t = theme();
    const row = (label, key, action) =>
      h_flex().id('more-' + action.name).h(30).px(10).gap(8).items_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { run(action.name, action.args); closeOverlay(props().overlay); })
        .child(div().text_size(12.5).text_color(t.foreground).child(label))
        .child(div().flex_1())
        .when(Boolean(key), e => e.child(mono(key)));

    return v_flex().w(200).p(6).gap(1).bg(t.chrome).border_1().border_color(t.border).rounded(10)
      .shadow_lg()
      .child(row('Settings', '', { name: 'app.settings' }))
      .child(row('Add machine', '', { name: 'mod.open', args: { name: 'machine-add' } }));
  }
}
