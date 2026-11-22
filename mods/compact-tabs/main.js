import { terminalTitles, fitTabs, menuOrder, taskName, matches } from "./navigation.js";
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, terminals, props, closeOverlay, setShared } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

export default class Tabs extends View {
  init() {
    if (props()?.terminalOnly) return;
    this.history = new Map();
    this.stripWidth = 680;
    if (props()?.context) return;
    if (props()?.picker) {
      this.input = InputState.new({ placeholder: "搜索任务、工具或终端号" });
      this.input.on("change", (_e, cx) => cx.notify());
      this.input.on("submit", () => this.choose(this.results()[0]));
      this.searching = false;
      return;
    }
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  describe(tab, ps = panes(), ts = terminals()) {
    const lead = ps.find(p => p.tab === tab.id && p.program?.agent) ?? ps.find(p => p.tab === tab.id);
    const term = ts.find(t => t.address === lead?.terminal);
    const name = taskName(term?.labels?.["workbench.name"], label(tab, lead));
    const manual = tab.named ? tab.name : null;
    return { id:tab.id, name, manual, shell: Boolean(lead?.program?.shell && !lead.program.agent),
      cwd:lead?.cwd, program:lead?.program, address:lead?.terminal };
  }

  descriptions(tabs) {
    const ps = panes(), ts = terminals();
    const entries = tabs.map(tab => this.describe(tab,ps,ts));
    const titles = terminalTitles(entries);
    return new Map(entries.map(entry => [entry.id,{...entry,name:titles.get(entry.id)}]));
  }

  results(tabs = spaces().find(s => s.id === props().space)?.tabs ?? [], descriptions = this.descriptions(tabs)) {
    return menuOrder(tabs, props().previous).filter(tab => {
      const { name, program, address } = descriptions.get(tab.id);
      return matches([name, program?.name, address], this.input.value());
    });
  }

  choose(tab) {
    if (!tab) return;
    closeOverlay(props().overlay);
    run("tab.select", { id: tab.id });
  }

  picker(t) {
    const pins = shared("compact.tabs.pins") ?? [];
    const tabs = spaces().find(s => s.id === props().space)?.tabs ?? [];
    const descriptions = this.descriptions(tabs);
    const rows = this.results(tabs,descriptions).map(tab => {
      const { name, address } = descriptions.get(tab.id);
      const pinned = pins.includes(tab.id);
      return h_flex().id("row-" + tab.id).min_h(32).px(6).gap(8).items_center().rounded(5)
        .hover(s => s.bg(t.hover)).cursor_pointer().on_click(() => this.choose(tab))
        .child(div().w(14).text_color(t.accent).child(tab.active ? "✓" : ""))
        .child(div().id("pick-" + tab.id).flex_1().min_w(0).child(name))
        .child(div().text_size(11).text_color(t.dim).child(address ?? ""))
        .child(div().id("pin-" + tab.id).on_click((_e,cx) => {
          cx.stop_propagation();
          setShared("compact.tabs.pins", pinned ? pins.filter(id => id !== tab.id) : [...pins, tab.id]);
          cx.notify();
        }).child(pinned ? "取消固定" : "固定"));
    });
    return v_flex().w_full().h(Math.min(340, 58 + Math.max(1, rows.length) * 32)).p(8).bg(t.raised).text_size(12.5)
      .when(this.searching, el => el.child(Input.new(this.input).h(32)))
      .when(!this.searching, el => el.child(div().id("filter-tabs").py(5).px(6).text_color(t.muted)
        .on_click((_e, cx) => { this.searching = true; cx.notify(); this.input.focus(); }).child("搜索标签…")))
      .child(v_flex().flex_1().min_h(0).id("matches").overflow_y_scrollbar().children(rows))
      .when(!rows.length, el => el.child("没有匹配的标签"));
  }

  rename(tab) {
    const { address, program, name } = this.describe(tab);
    if (!program?.agent || !address) return run("tab.rename", { id: tab.id });
    const space = spaces().find(s => s.tabs.some(t => t.id === tab.id));
    const siblings = terminals().filter(t => t.address !== address && t.labels?.["herdr.space"] === space?.id)
      .map(t => t.labels?.["workbench.name"] || t.name).filter(Boolean);
    openOverlay({ mod: "agents-order", kind: "dialog", width: 340, props: { rename: true, address, name, siblings } });
  }

  contextMenu(t, space) {
    const tab = space?.tabs.find(tab => tab.id === props().context);
    if (!tab) return div();
    const pins = shared("compact.tabs.pins") ?? [];
    const pinned = pins.includes(tab.id);
    const actions = [
      ["重命名", () => this.rename(tab)],
      [pinned ? "取消固定" : "固定标签", () => setShared("compact.tabs.pins", pinned ? pins.filter(id => id !== tab.id) : [...pins, tab.id])],
      ["新建标签", () => run("tab.new", { space: space.id })],
      ["关闭标签", () => run("tab.close", { id: tab.id })],
    ];
    return v_flex().p(4).bg(t.raised).children(actions.map(([name, action]) =>
      div().id(name).px(8).py(6).text_size(12.5).hover(s => s.bg(t.hover))
        .on_click(() => { closeOverlay(props().overlay); action(); }).child(name)));
  }

  render() {
    const t = theme();
    if (props()?.terminalOnly) {
      const createTerminal = () => {
        const active = spaces().find(space => space.active);
        if (active) run("tab.new", { space: active.id });
      };
      return h_flex().size_full().px(8).items_center().bg(t.chrome)
        .child(div().id("terminal-new").size(26).flex().items_center().justify_center()
          .rounded(6).text_color(t.muted).cursor_pointer()
          .hover(style => style.bg(t.hover).text_color(t.foreground))
          .tooltip("在当前 Space 新建终端").on_click(createTerminal).child("+"));
    }
    const space = spaces().find(p => p.active);
    if (props()?.context) return this.contextMenu(t, space);
    if (props()?.picker) return this.picker(t);
    const tabs = space?.tabs ?? [];
    const current = tabs.find(tab => tab.active)?.id;
    let recent = this.history.get(space?.id) ?? [];
    if (current && recent[0] !== current) {
      recent = [current, ...recent.filter(id => id !== current && tabs.some(tab => tab.id === id))];
      this.history.set(space.id, recent);
    }
    const pins = shared("compact.tabs.pins") ?? [];
    const descriptions = this.descriptions(tabs);
    const widths = new Map(tabs.map(tab => {
      const { name, program } = descriptions.get(tab.id);
      const text = Array.from(name).reduce((px, c) => px + (c.codePointAt(0) > 255 ? 14 : 8), 0);
      return [tab.id, 27 + (program?.icon ? 21 : 0) + (tab.active ? 19 : 0) + (tab.status && tab.status !== "idle" ? 19 : 0) + text];
    }));
    const shown = fitTabs(tabs, pins, recent, widths, this.stripWidth);
    const hidden = tabs.filter(tab => !shown.includes(tab));
    const waiting = hidden.filter(tab => tab.status === "blocked").length;
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const { program, name } = descriptions.get(c.id);
      return h_flex().id(`tab-${c.id}`).w(Math.max(38, Math.min(widths.get(c.id) - 3, this.stripWidth - (hidden.length ? 33 : 3)))).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) { this.pressed = null; this.rename(c); } })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else if (from !== null) run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "compact-tabs", kind: "popup", width: 160, props: { context: c.id } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().flex_1().min_w(0).truncate().tooltip(name).child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((size, cx) => {
          if (Math.abs(size.width - this.stripWidth) >= 1) { this.stripWidth = size.width; cx.notify(); }
        })
        .children(shown.map(item))
        .when(hidden.length > 0, el => el.child(h_flex().id("more-tabs").w(27).h_full().flex_none()
          .items_center().justify_center().cursor_pointer().rounded(5).hover(s => s.bg(t.hover))
          .tooltip("全部标签" + (waiting ? " · " + waiting + " 待处理" : ""))
          .on_mouse_down("left", stop).on_click(() => openOverlay({ mod: "compact-tabs", kind: "popup", width: 400,
            height: 340, props: { picker: true, space: space.id, previous: recent[1] } }))
          .child(svg("mods/workspace-chrome/chevron-down.svg").size(13).text_color(t.muted))
          .when(waiting > 0, node => node.child(div().size(4).rounded(2).bg(t.blocked))))))
      .when(Boolean(recent[1]) && tabs.some(tab => tab.id === recent[1]), el => el.child(button("last-tab", "↶", () => run("tab.select", { id: recent[1] })).tooltip("切回上一页")))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
