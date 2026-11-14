// 顶栏：左侧仓库/分支，中间计数与运行状态，右侧缓存、搜索、侧栏开关、深浅色开关。
// 配色走本目录的 palette.js（与 agent-workbench 同源拷贝）。
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, spaces, agents } from "herdr";
import { palette, mode } from "./palette.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// 折叠=整块隐藏，不再缩成 76 窄条（手动最窄由布局 min 240 保证）。
function toggleSidebar() {
  run("layout.toggle", { id: "sidebar" });
}

// 当前 Space：用于左侧仓库名与分支。
function activeSpace() {
  const all = spaces();
  return all.find(s => s.active) ?? all[0] ?? null;
}

export default class WorkspaceChrome extends View {
  button(id, label, action, p) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(p.subtle).hover(s => s.bg(p.hover).text_color(p.ink))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  // 深浅色开关：写 shared("ui.mode")，各 mod 下次绘制读它。
  themeToggle(p, cx) {
    const dark = l => l === 'dark';
    return div().id('ui-mode').size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(p.subtle).hover(s => s.bg(p.hover).text_color(p.ink)).cursor_pointer()
      .tooltip(dark(mode(shared)) ? '切到浅色' : '切到深色')
      .on_mouse_down("left", (_e, ev) => ev.stop_propagation())
      .on_click((_e, ev) => {
        setShared('ui.mode', dark(mode(shared)) ? 'light' : 'dark');
        ev.notify();
      })
      .child(div().text_size(13).child(dark(mode(shared)) ? '☀' : '☾'));
  }
  render() {
    const t = theme();
    const p = palette(mode(shared));
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? p.subtle : p.muted).hover(s => s.bg(p.hover).text_color(p.ink)).cursor_pointer()
        .on_click(action).child(svg(`mods/workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(p.accent);
      return v_flex().size_full().bg(p.canvas).px(8).pt(4).pb(8).text_size(12.5)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    const space = activeSpace();
    const metrics = (() => {
      const m = shared('ui.metrics');
      if (!m || typeof m !== 'object') {
        const list = agents();
        const working = list.filter(a => a.status === 'working').length;
        const blocked = list.filter(a => a.status === 'blocked').length;
        const items = [{ label: '', text: `${list.length} 个 Agent` },
                       { label: '', text: `${working} 运行中` }];
        if (blocked) items.push({ label: '', text: `${blocked} 待审` });
        return items.map(it => h_flex().gap(4).items_center().child(div().text_size(12).text_color(p.muted).child(it.text)));
      }
      return ['session', 'week', 'context', 'model'].filter(k => m[k]).map(k =>
        h_flex().gap(5).items_center()
          .child(div().text_size(11).text_color(p.subtle).child({ session: 'Session', week: '7d', context: 'Context', model: '' }[k]))
          .child(div().text_size(12).text_color(p.muted).child(String(m[k]))));
    })();
    const sep = div().w(1).h(10).bg(p.lineStrong);
    return h_flex().size_full().bg(p.canvas).pl(collapsed ? 6 : 14).pr(10).gap(8).items_center().text_size(13)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      // 左：仓库（Space 名）+ 分支
      .when(!collapsed && space, el => el.child(h_flex().gap(6).items_center()
        .child(div().text_size(12.5).font_semibold().text_color(p.ink).child(space.name))
        .when(Boolean(space.branch), e => e.child(div().px(6).py(1).rounded(5).bg(p.raised)
          .text_size(11).text_color(p.accent).child(space.branch)))))
      .child(div().flex_1())
      // 中：计数/指标
      .when(metrics.length, el => el.child(h_flex().gap(10).items_center().children(metrics.flatMap((m, i) => i ? [sep, m] : [m]))))
      // 右：搜索、侧栏开关、深浅色
      .when(!collapsed, el => el.child(this.button("search", svg("mods/workspace-chrome/search.svg").size(14), () => run("mod.open", { name: "picker" }), p)))
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/workspace-chrome/sidebar.svg").size(14), toggleSidebar, p)))
      .when(!collapsed, el => el.child(this.themeToggle(p)));
  }
}
