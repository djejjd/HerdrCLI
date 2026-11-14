// 工作台标签栏：沿用 Herdr 原生行为与已核实菜单，统一状态图标。
import { statusIcon } from './status.js';
import { sidebarToggle } from './controls.js';
import { PendingStore, chipState, classifyTarget, rowKey, ageText, fixturePath } from './pending.js';
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, props, home, exec, readTextFile } from "herdr";

const REASONS = { "no-header": "没有表格表头", "no-what": "缺「要你做什么」列", "no-status": "缺「状态」列", unreadable: "内容不是文本" };

function loadAcks() {
  try {
    const v = JSON.parse(localStorage.getItem("approvals.acks") ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // 待批 chip：只读账本，5 秒刷新一次；失焦时降到 30 秒。
    this.acks = loadAcks();
    this.sig = "";
    this.lastPoll = 0;
    this.store = new PendingStore({ read: async () => readTextFile(this.ledgerPath()) });
    // 列表弹层只读一次，不另起轮询；常驻 chip 才需要定时刷新。
    if (!_props?.approvals) this.timer = cx.timer.every(5000, c => this.pollApprovals(c));
    this.pollApprovals(cx);
  }

  // 终态：作废在途读取并停表，popup 关闭后不再持有任何定时器。
  close() {
    this.store?.close();
    this.timer?.cancel?.();
    this.timer = null;
  }

  // 账本路径：默认全局账本；fixture 覆盖仅在有效期内且指向临时目录时生效，非法/过期立刻清掉。
  ledgerPath() {
    const raw = localStorage.getItem("approvals.fixture");
    const fixture = fixturePath(raw);
    if (raw && !fixture) localStorage.removeItem("approvals.fixture");
    return fixture ?? `${home()}/ai/collab/pending.md`;
  }

  pollApprovals(cx) {
    if (!this.store || this.store.closed) return;
    const now = Date.now();
    if (window()?.active === false && now - this.lastPoll < 30000) return;
    this.lastPoll = now;
    this.store.refresh().then(() => {
      if (this.store.closed) return;
      const state = this.store.state;
      this.pruneAcks(state.rows ?? []);
      const sig = `${state.kind}:${state.count ?? 0}:${state.reason ?? ""}:${state.rows?.length ?? 0}`;
      if (sig !== this.sig) { this.sig = sig; cx.notify(); }
    }).catch(() => {});
  }

  // 已读只保留当前还存在的行，账本删行后 ack 自动回收（上限 200）。
  pruneAcks(rows) {
    const live = new Set(rows.map(rowKey));
    let changed = false;
    for (const k of Object.keys(this.acks)) if (!live.has(k)) { delete this.acks[k]; changed = true; }
    if (changed) localStorage.setItem("approvals.acks", JSON.stringify(this.acks));
  }

  toggleAck(key) {
    if (this.acks[key]) delete this.acks[key]; else this.acks[key] = Date.now();
    localStorage.setItem("approvals.acks", JSON.stringify(this.acks));
  }

  // 只读打开：URL 仅 http/https，路径先 stat 再 open，绝不拼 shell。
  openTarget(raw) {
    const target = classifyTarget(raw, home());
    if (!target) return;
    if (target.kind === "url") { exec("/usr/bin/open", [target.value]); return; }
    exec("/usr/bin/stat", [target.value])
      .then(r => { if (r?.code === 0) exec("/usr/bin/open", [target.value]); })
      .catch(() => {});
  }

  hint(s) {
    const where = this.ledgerPath();
    if (s.kind === "missing") return `账本缺失：${where}`;
    if (s.kind === "error") return `账本无法解析（${REASONS[s.reason] ?? s.reason}）：${where}`;
    return `待批 ${s.count} 条 · 账本 ${where}`;
  }

  approvalChip(t) {
    const s = chipState(this.store?.state);
    if (s.kind === "hidden") return null;
    const bad = s.kind === "missing" || s.kind === "error";
    return h_flex().id("approvals-chip").h(26).px(7).gap(5).flex_none().items_center().rounded(6)
      .bg(t.hover).text_color(bad ? t.dim : t.blocked).cursor_pointer()
      .tooltip(this.hint(s))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "workbench-tabs", kind: "popup", width: 380, height: 380, props: { approvals: true } });
      })
      .child(statusIcon(bad ? "idle" : "blocked", t))
      .child(div().text_size(12).font_medium().child(bad ? "待批 ?" : `待批 ${s.count}`));
  }

  approvalRow(r, t) {
    const key = rowKey(r), acked = Boolean(this.acks[key]);
    const target = classifyTarget(r.where, home());
    return v_flex().id(`ap-${key}`).gap(2).px(8).py(6).rounded(6).hover(s => s.bg(t.hover))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().opacity(acked ? 0.55 : 1).child(r.what))
        .child(div().text_size(11).text_color(t.dim).child(ageText(r))))
      .when(Boolean(r.impact), el => el.child(div().text_size(11.5).text_color(t.muted).truncate().child(`不做会怎样：${r.impact}`)))
      .child(h_flex().gap(6).items_center()
        .when(Boolean(r.project), el => el.child(div().text_size(11).text_color(t.dim).child(r.project)))
        .child(div().flex_1())
        .child(h_flex().h(20).px(6).items_center().rounded(5).cursor_pointer().bg(t.hover)
          .on_click((_e, cx) => { cx.stop_propagation(); this.toggleAck(key); cx.notify(); })
          .child(div().text_size(11).text_color(acked ? t.accent : t.muted).child(acked ? "已读" : "标已读")))
        .when(Boolean(target), el => el.child(h_flex().h(20).px(6).items_center().rounded(5).cursor_pointer().bg(t.hover)
          .tooltip(r.where)
          .on_click((_e, cx) => { cx.stop_propagation(); this.openTarget(r.where); })
          .child(div().text_size(11).text_color(t.muted).child("打开"))))
      .when(Boolean(r.where) && !target, el => el.child(div().text_size(11).text_color(t.dim).truncate().child(r.where))));
  }

  approvalsPanel(t) {
    const state = this.store?.state ?? { kind: "hidden" };
    const rows = state.rows ?? [];
    const path = this.ledgerPath();
    const head = h_flex().gap(6).items_center().px(2)
      .child(div().text_size(13).font_semibold().child(rows.length ? `待你批准 ${rows.length} 条` : "待你批准"))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child("只读"));
    const empty = state.kind === "missing"
      ? [div().text_size(12).text_color(t.muted).child("账本不存在"), div().text_size(11).text_color(t.dim).truncate().child(path), div().text_size(11).text_color(t.dim).child("监督方创建账本后，这里会列出待批条目。")]
      : state.kind === "error"
        ? [div().text_size(12).text_color(t.muted).child(`账本无法解析：${REASONS[state.reason] ?? state.reason}`), div().text_size(11).text_color(t.dim).truncate().child(path)]
        : [div().text_size(12).text_color(t.muted).child("没有待批条目")];
    const body = rows.length ? rows.map(r => this.approvalRow(r, t)) : [v_flex().p(10).gap(4).children(empty)];
    return v_flex().size_full().p(10).gap(6)
      .child(head)
      .child(v_flex().flex_1().min_h(0).gap(2).overflow_y_scrollbar().children(body))
      .child(h_flex().gap(6).items_center().px(2)
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).tooltip(path).child(path))
        .child(h_flex().h(20).px(6).items_center().rounded(5).cursor_pointer().bg(t.hover)
          .on_click((_e, cx) => { cx.stop_propagation(); this.openTarget(path); })
          .child(div().text_size(11).text_color(t.muted).child("在编辑器打开"))));
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

  render() {
    const t = theme();
    if (props()?.approvals) return this.approvalsPanel(t);
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
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
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).relative().h(30).px(8).gap(6).rounded(6).items_center().flex_none().text_size(12.5)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .bg(c.active ? t.selected : t.chrome).text_color(c.active ? t.foreground : t.muted).when(c.active, el => el.font_medium())
        .when(!c.active, el => el.hover(s => s.bg(t.hover)))
        .when(c.active, el => el.child(div().absolute().left(6).right(6).bottom(0).h(2).rounded(1).bg(t.accent)))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(statusIcon("working",t)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(statusIcon(c.status,t)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // 常驻侧栏开关：侧栏隐藏后品牌栏会一起消失，这里是唯一可见入口。
    const side = sidebarToggle(root);
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
    return h_flex().size_full().min_w(0).px(12).pl(lightsPadding).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(button("sidebar-toggle", svg(side.icon).size(14), () => run(side.command, side.args)).tooltip(side.label))
      .when(chipState(this.store?.state).kind !== "hidden", el => el.child(this.approvalChip(t)))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(2).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "workbench-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/verified-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/verified-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/verified-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
