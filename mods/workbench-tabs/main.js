// 工作台标签栏：沿用 Herdr 原生行为与已核实菜单，统一状态图标。
import { statusIcon } from './status.js';
import { sidebarToggle } from './controls.js';
import { PendingStore, chipState, classifyTarget, rowKey, ageText, fixturePath, listPlan, ledgerSignature, pickState, rowsForSpace, countRows, chipNode, globalCount, filterVisibleTabs, ensurePlan, settlePlan, spacePlan, chipTarget, createArgs, createArgs2, legacyCreateArgs, createFailure, tabDot, readyGate, spaceSignature, markerPlan, createdRing, requestPlan, creationPlan, cleanupPlan, cleanupLogLine, retryPlan, cleanupFailureLine, rowActions, decisionEvent, chipLabel } from './pending.js';
import { View, div, svg, image } from "gpui-kit";
import * as fsPromises from "fs/promises";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, props, home, appHome, exec, readTextFile, hc } from "herdr";

const PAGE = 6;
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
    this.acks = loadAcks();
    this.sig = "";
    this.lastPoll = 0;
    this.store = new PendingStore({ read: async () => readTextFile(this.ledgerPath()) });
    this.published = "";
    this.sent = "";
    this.sending = null;
    this.decisionError = null;
    this.creating = false;
    this.createError = null;
    this.cleanupError = null;
    this.closeTries = new Map();
    this.startedAt = Date.now();
    this.firstReadAt = null;
    this.ensured = new Set();
    this.lastOurs = new Map();
    this.prevTab = new Map();
    this.lastSwitchAt = new Map();
    this.pendingTabId = null;
    this.localCount = 0;
    this.errorText = null;
    this.created = JSON.parse(localStorage.getItem("approvals.created") ?? "{}");
    if (_props?.approvals) {
      this.page = 0;
      this.store.refresh().then(() => { if (!this.store.closed) cx.notify(); }).catch(() => {});
      this.timer = cx.timer.every(2000, c => {
        if (this.store?.closed) return;
        this.store.refresh().then(() => { if (!this.store.closed) c.notify(); }).catch(() => {});
      });
      return;
    }
    this.timer = cx.timer.every(5000, c => this.pollApprovals(c));
    // 侧栏请求快速消费：不占 5 秒轮询。
    this.reqTimer = cx.timer.every(500, c => this.consumeRequest(c));
    this.pollApprovals(cx);
  }

  // 只记时间/Space/错误首行，不写账本正文；写失败也不影响界面。
  logCreateFailure(line) {
    try { fsPromises.appendFile(`${appHome()}/approvals-create.log`, `${line}\n`).catch(() => {}); } catch {}
  }

  // 执行单个清理动作：失败写日志 + tooltip 可见；同一 id 最多 2 次、间隔 30 秒。
  runCleanup(action, id, fn) {
    const now = Date.now();
    const st = this.closeTries.get(id) ?? { n: 0, at: 0 };
    const decision = retryPlan({ tries: st.n, lastAt: st.at, now });
    if (decision === "wait") return "wait";
    if (decision === "giveup") {
      this.logCleanup(`gave-up action=${action} id=${id} tries=${st.n}`);
      this.cleanupError = `清理失败：${id}`;
      return "giveup";
    }
    try {
      fn();
      this.closeTries.delete(id);
      this.cleanupError = null;
      return "ok";
    } catch (error) {
      this.closeTries.set(id, { n: st.n + 1, at: now });
      this.cleanupError = `清理失败：${id}`;
      this.logCleanup(cleanupFailureLine({ action, id, error, now }));
      return "fail";
    }
  }

  // 清理日志：只有 Space、待批 id、keep、动作。
  logCleanup(spaceId, plan) {
    const line = cleanupLogLine({ spaceId, plan });
    try { fsPromises.appendFile(`${appHome()}/approvals-cleanup.log`, `${line}\n`).catch(() => {}); } catch {}
  }

  // 侧栏点击：清 marker → 已有则展开/选中；没有则建，建完选中（select 自带展开）。
  consumeRequest(cx) {
    const req = requestPlan({ request: shared("approvals.openRequest") });
    if (!req) return;
    setShared("approvals.openRequest", null);
    const sp = spaces().find(s => s.id === req.space);
    if (!sp) return;
    const markers = JSON.parse(localStorage.getItem("approvals.closed") ?? "{}");
    delete markers[req.space];
    localStorage.setItem("approvals.closed", JSON.stringify(markers));
    const ours = (sp.tabs ?? []).find(t => t.name === "待批" && panes().find(p => p && p.tab === t.id)?.mod === "workbench-tabs");
    if (ours) {
      if (ours.settled) run("tab.unsettle", { id: ours.id });
      run("tab.select", { id: ours.id });
      return;
    }
    try { run("tab.new", createArgs2({ space: req.space })); } catch { return; }
    cx.timer.after(400, () => {
      const tabs = spaces().find(s => s.id === req.space)?.tabs ?? [];
      const tab = tabs.find(t => t.name === "待批");
      if (!tab) return;
      this.created[req.space] = createdRing(this.created[req.space], tab.id, 20);
      localStorage.setItem("approvals.created", JSON.stringify(this.created));
      if (tab.settled) run("tab.unsettle", { id: tab.id });
      run("tab.select", { id: tab.id });
    });
  }

  close() {
    this.store?.close();
    this.timer?.cancel?.();
    this.timer = null;
    this.reqTimer?.cancel?.();
    this.reqTimer = null;
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
      this.publishApprovals(state);
      const space = spaces().find(s => s.active);
      const tabs = space?.tabs ?? [];
      this.firstReadAt ??= Date.now();
      const ready = readyGate({ startedAt: this.startedAt, firstReadAt: this.firstReadAt });
      const act = spaces().find(x => x.active);
      const markers = JSON.parse(localStorage.getItem("approvals.closed") ?? "{}");
      const allSpaces = spaces();
      const sigFor = sp => spaceSignature({ rows: state.rows ?? [], space: sp, knownSpaces: allSpaces });
      const oursOf = tabs => (tabs ?? []).filter(t => t.name === "待批" && panes().find(p => p && p.tab === t.id)?.mod === "workbench-tabs");

      // 1) 关闭检测必须先于重建：上一轮有、本轮没有，且不是 cleanup 关的（keep 仍在说明不是）
      let markerDirty = false;
      for (const sp of allSpaces) {
        const ids = oursOf(sp?.tabs).map(t => t.id);
        const prev = this.lastOurs.get(sp.id) ?? [];
        const gone = prev.filter(id => !ids.includes(id));
        if (gone.length && prev.length && !ids.length) {
          markers[sp.id] = { signature: sigFor(sp), at: Date.now() };
          markerDirty = true;
          const target = this.prevTab.get(sp.id);
          if (target && Date.now() - (this.lastSwitchAt.get(sp.id) ?? 0) > 5000 && (sp.tabs ?? []).some(t => t.id === target)) {
            run("tab.select", { id: target });
          }
        }
        this.lastOurs.set(sp.id, ids);
      }
      if (markerDirty) localStorage.setItem("approvals.closed", JSON.stringify(markers));

      // 2) 三路分流：prebuild / ensure / force；共用创建锁
      const req = requestPlan({ request: shared("approvals.openRequest") });
      for (const sp of allSpaces) {
        const tabs = sp?.tabs ?? [];
        const count = countRows(rowsForSpace(state.rows ?? [], sp, allSpaces));
        const sig = sigFor(sp);
        const force = req && req.space === sp.id;
        if (force) { delete markers[sp.id]; localStorage.setItem("approvals.closed", JSON.stringify(markers)); setShared("approvals.openRequest", null); }
        const mk = markerPlan({ marker: markers[sp.id], signature: sig, count, force });
        let mode = null;
        if (force) mode = "force";
        else if (sp.id === act?.id && ready && !this.ensured.has(sp.id)) mode = "prebuild";
        else if (count > 0) mode = "ensure";
        if (!mode) continue;
        const plan = creationPlan({ tabs, panes: panes(), count, mode, markerKeep: mk.keep });
        if (plan === "unsettle") {
          const t = (tabs ?? []).find(x => x.name === "待批");
          if (t) this.runCleanup("unsettle", t.id, () => run("tab.unsettle", { id: t.id }));
        }
        if (plan === "create" && !this.creating) {
          this.creating = true;
          const prevActive = tabs.find(x => x.active)?.id ?? null;
          if (prevActive) this.prevTab.set(sp.id, prevActive);
          try {
            run("tab.new", createArgs2({ space: sp.id }));
            this.createError = null;
          } catch (error) {
            const st = createFailure({ spaceId: sp.id, error });
            this.creating = st.creating;
            this.createError = st.createError;
            this.logCreateFailure(st.logLine);
            continue;
          }
          const createdSpace = sp.id;
          cx.timer.after(600, () => {
            this.creating = false;
            const t = spaces().find(x => x.id === createdSpace)?.tabs ?? [];
            const e = ensurePlan(t, panes());
            if (e.kind !== "exists") return;
            this.created[createdSpace] = createdRing(this.created[createdSpace], e.tab, 20);
            localStorage.setItem("approvals.created", JSON.stringify(this.created));
            this.logCleanup(`ensure-create space=${createdSpace} created=${e.tab} prevActive=${prevActive ?? "-"}`);
            const tab = t.find(x => x.id === e.tab);
            if (!tab || tab.settled) return;
            const c = countRows(rowsForSpace(this.store.state.rows ?? [], spaces().find(x => x.id === createdSpace), spaces()));
            if (settlePlan({ count: c, active: tab.active === true, settled: false }) === "settle") {
              this.runCleanup("settle", e.tab, () => run("tab.settle", { id: e.tab }));
            }
          });
        }
        this.ensured.add(sp.id);
      }

      // 3) cleanup（历史重复；按 Space 计数）
      const plans = [];
      for (const sp of allSpaces) {
        const tabs = sp?.tabs ?? [];
        const count = countRows(rowsForSpace(state.rows ?? [], sp, allSpaces));
        const plan = cleanupPlan(tabs, panes(), count);
        if (!plan.keep) continue;
        const pendingIds = tabs.filter(t => t.name === "待批").map(t => t.id);
        if (plan.select.length || plan.close.length || plan.settle.length) plans.push({ sp, plan, pendingIds });
      }
      for (const { sp, plan, pendingIds } of plans) {
        this.logCleanup(`start space=${sp?.id} pending=${pendingIds.join(",") || "-"} keep=${plan.keep} close=${plan.close.join(",") || "-"} settle=${plan.settle.join(",") || "-"}`);
        const results = [];
        for (const id of plan.select) results.push(this.runCleanup("select", id, () => run("tab.select", { id })));
        for (const id of plan.close) results.push(this.runCleanup("close", id, () => run("tab.close", { id, confirmed: true })));
        for (const id of plan.settle) results.push(this.runCleanup("settle", id, () => run("tab.settle", { id })));
        this.logCleanup(`done space=${sp?.id} keep=${plan.keep} closed=${plan.close.length} settled=${plan.settle.length} failed=${results.filter(r => r === "fail").length}`);
      }
      // 当前 Space 的展示状态（红点/空态/错误行）
      const cur = act;
      const curTabs = cur?.tabs ?? [];
      this.localCount = countRows(rowsForSpace(state.rows ?? [], cur, allSpaces));
      this.pendingTabId = oursOf(curTabs)[0]?.id ?? null;
      this.errorText = this.createError || this.cleanupError || (state.kind === "missing" ? "账本缺失" : state.kind === "error" ? "账本解析失败" : null);
      const sig = `${state.kind}:${state.count ?? 0}:${state.rows?.length ?? 0}`;
      if (sig !== this.sig) { this.sig = sig; cx.notify(); }
    }).catch(() => {});
  }

  // 把状态发布给所有 mod（待批标签据此更新）；只在内容变化时发，避免 shared 重绘循环。
  publishApprovals(state) {
    // 用内容签名而不是条数：换一条、改一个字都要让面板看到新内容。
    const key = ledgerSignature(state);
    if (key === this.published) return;
    this.published = key;
    setShared("approvals.state", {
      kind: state.kind,
      count: state.count ?? 0,
      reason: state.reason ?? null,
      rows: (state.rows ?? []).map(r => ({ what: r.what, impact: r.impact, where: r.where, proposedAt: r.proposedAt, project: r.project, done: r.done })),
      at: this.store?.at ?? null,
    });
  }

  // 待批标签读 shared 的状态；没有时退回自己那一次读取。
  panelState() {
    const own = this.store?.state;
    const ownState = own && own.kind !== "hidden"
      ? { kind: own.kind, count: own.count ?? 0, reason: own.reason ?? null, rows: own.rows ?? [], at: this.store?.at ?? 0 }
      : null;
    // 刚打开时本地读取比 shared 新，就用本地的，避免先看到上一轮旧内容。
    return pickState(shared("approvals.state"), ownState);
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
    if (this.createError) return this.createError;
    if (this.cleanupError) return this.cleanupError;
    const where = this.ledgerPath();
    if (s.kind === "missing") return `账本缺失：${where}`;
    if (s.kind === "error") return `账本无法解析（${REASONS[s.reason] ?? s.reason}）：${where}`;
    const all = s.globalCount ? `（含全局 ${s.globalCount}）` : "";
    return `待批 ${s.count} 条${all} · 账本 ${where}`;
  }

  // 当前 Space 的待批状态：全局行恒算，本 Space 行按名或 id 匹配；0 条即隐藏。
  localApprovals() {
    const state = this.store?.state;
    if (!state || state.kind !== "count") return state ?? { kind: "hidden" };
    const rows = rowsForSpace(state.rows ?? [], spaces().find(s => s.active), spaces());
    const count = countRows(rows);
    return count > 0 ? { kind: "count", count, rows, globalCount: globalCount(rows) } : { kind: "hidden" };
  }

  approvalChip(t) {
    // 0 条时完全不渲染（不建容器、不占宽），后面的标签自然靠过来。
    const s = chipState(this.localApprovals());
    if (!chipNode(s)) return null;
    const bad = s.kind === "missing" || s.kind === "error";
    return h_flex().id("approvals-chip").h(24).px(7).gap(4).flex_none().items_center().rounded(6)
      .bg(t.selected).text_color(bad ? t.dim : t.blocked).cursor_pointer()
      .tooltip(bad ? "待批账本有问题，点击查看" : `待审批 ${s.count} 条，点击打开待批页面`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stopPropagation?.();
        cx.stop_propagation();
        const space = spaces().find(s => s.active);
        const id = chipTarget({ panes: panes(), tabs: space?.tabs ?? [] });
        if (id) run("tab.select", { id });
      })
      .child(statusIcon(bad ? "idle" : "blocked", t))
      .child(div().text_size(11).font_semibold().child(chipLabel(s)));
  }

  approvalRow(r, t) {
    const key = rowKey(r), acked = Boolean(this.acks[key]);
    const target = classifyTarget(r.where, home());
    return v_flex().id(`ap-${key}`).gap(2).px(8).py(6).rounded(6).hover(s => s.bg(t.hover))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).whitespace_normal().max_h(32).overflow_hidden().tooltip(r.what)
          .text_size(12.5).font_medium().opacity(acked ? 0.55 : 1).child(r.what))
        .child(div().text_size(11).text_color(t.dim).child(ageText(r))))
      .when(Boolean(r.impact), el => el.child(div().text_size(11.5).text_color(t.muted).truncate().child(`不做会怎样：${r.impact}`)))
      .child(h_flex().gap(6).items_center()
        .child(div().h(16).px(5).items_center().rounded(4).border(1).border_color(t.border)
          .child(div().text_size(10).text_color(r.type === "选择" ? t.accent : t.dim).child(r.type)))
        .when(r.type === "选择" && Boolean(r.suggestion), el => el.child(div().flex_1().min_w(0).truncate()
          .text_size(11).text_color(t.muted).tooltip(r.suggestion).child(`我建议：${r.suggestion}`)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim)
          .tooltip(r.space ? (r.project || r.space) : "全局条目：所有 Space 都显示")
          .child(r.space ? (r.project || r.space) : "全局"))
        .child(h_flex().h(20).px(6).items_center().rounded(5).cursor_pointer().bg(t.hover)
          .on_click((_e, cx) => { cx.stop_propagation(); this.toggleAck(key); cx.notify(); })
          .child(div().text_size(11).text_color(acked ? t.accent : t.muted).child(acked ? "已读" : "标已读")))
        .when(Boolean(target), el => el.child(h_flex().h(20).px(6).items_center().rounded(5).cursor_pointer().bg(t.hover)
          .tooltip(r.where)
          .on_click((_e, cx) => { cx.stop_propagation(); this.openTarget(r.where); })
          .child(div().text_size(11).text_color(t.muted).child("打开")))))
      .when(Boolean(r.where) && !target, el => el.child(div().text_size(11).text_color(t.dim).truncate().child(r.where)))
      .child(h_flex().gap(6).items_center().px(2).py(2)
        .children(this.decisionButtons(r, t, key))
        .child(div().flex_1())
        .when(this.sent === key, el => el.child(div().text_size(11).text_color(t.accent).child("已发送，等监督者更新账本")))
        .when(Boolean(this.decisionError), el => el.child(h_flex().gap(4).items_center()
          .child(div().text_size(11).text_color(t.blocked).child("发送失败"))
          .child(h_flex().h(18).px(5).items_center().rounded(4).cursor_pointer().bg(t.hover)
            .on_click((_e, cx) => { cx.stop_propagation(); try { cx.write_to_clipboard(this.lastMessage ?? ""); } catch {} })
            .child(div().text_size(10).text_color(t.muted).child("复制消息"))))));
  }

  // 动作按钮：授权=批准/拒绝/稍后；选择=按建议/备选/都不行/稍后。按钮不贴边、不整行可点。
  decisionButtons(r, t, key) {
    const busy = this.sending === key;
    const BTN = (label, decision) => h_flex().h(22).px(8).items_center().rounded(5).flex_none().bg(t.hover)
      .when(!busy, el => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); this.sendDecision(r, decision, cx); }))
      .child(div().text_size(11).text_color(busy ? t.dim : t.foreground).child(label));
    const out = [];
    for (const action of rowActions(r.type)) {
      if (action === "approve") out.push(BTN("批准", "approve"));
      else if (action === "reject") out.push(BTN("拒绝", "reject"));
      else if (action === "suggest") out.push(BTN("按建议", "suggest"));
      else if (action === "none") out.push(BTN("都不行", "none"));
      else if (action === "later") out.push(BTN("稍后", "later"));
      else if (action === "other") {
        (r.options ?? []).forEach((opt, i) => out.push(BTN(opt.length > 10 ? `${opt.slice(0, 10)}…` : opt, `other:${i + 1}`)));
      }
    }
    return out;
  }

  // 只发事件，不写账本；发送失败保留文案可复制重试。
  sendDecision(row, decision, cx) {
    if (this.sending) return;
    if (decision === "later") {
      // 标签模式：稍后 = 收起当前待批标签，不发事件、不改账本。
      const space = spaces().find(s => s.active);
      const id = chipTarget({ panes: panes(), tabs: space?.tabs ?? [] });
      if (id) this.runCleanup("settle", id, () => run("tab.settle", { id }));
      return;
    }
    const msg = decisionEvent(row, decision);
    this.lastMessage = msg;
    const sup = this.store?.state?.meta?.supervisor;
    if (!sup) { this.decisionError = true; cx.notify(); return; }
    this.sending = rowKey(row);
    cx.notify();
    hc(["send", sup, msg]).then(r => {
      if (r && r.code !== 0) throw new Error("send failed");
      this.sent = rowKey(row);
      this.sending = null;
      this.decisionError = false;
      cx.notify();
    }).catch(() => { this.sending = null; this.decisionError = true; cx.notify(); });
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

  pageButton(label, enabled, t, act) {
    return h_flex().h(22).px(8).items_center().rounded(5).flex_none()
      .when(enabled, el => el.cursor_pointer().bg(t.hover).on_click((_e, cx) => { cx.stop_propagation(); act(); cx.notify(); }))
      .child(div().text_size(11).text_color(enabled ? t.foreground : t.dim).child(label));
  }

  approvalsPanel(t) {
    const state = this.panelState();
    const path = this.ledgerPath();
    if (!state) {
      return v_flex().w_full().p(10).gap(6)
        .child(div().text_size(12).text_color(t.muted).child("读取中…"))
        .child(div().text_size(10.5).text_color(t.dim).truncate().child(path));
    }
    // 全部处理完：不再列条目，只给“已全部处理”与去留说明；自动关闭由轮询按规则做。
    if (state.kind === "empty") {
      const space = spaces().find(s => s.active);
      const tabs = space?.tabs ?? [];
      const hint = tabs.length <= 1 ? "本空间仅此标签，可手动关闭" : "切到其他标签后会自动关闭";
      return v_flex().w_full().p(10).gap(6)
        .child(h_flex().gap(6).items_center().px(2)
          .child(div().text_size(13).font_semibold().child("已全部处理"))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.dim).child("只读")))
        .child(div().p(10).text_size(12).text_color(t.muted).child(hint))
        .child(div().text_size(10.5).text_color(t.dim).px(2).truncate().tooltip(path).child(path));
    }
    // 只看当前 Space 可见的行（全局 + 本 Space）；已完成是终态不参与。
    const current = spaces().find(s => s.active);
    const rows = rowsForSpace(state.rows ?? [], current, spaces()).filter(r => !r.done);
    const plan = listPlan(rows, this.page ?? 0, PAGE);
    const head = h_flex().gap(6).items_center().px(2)
      .child(div().text_size(13).font_semibold().child(rows.length ? `待你批准 ${rows.length} 条` : "待你批准"))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child("只读"));
    const empty = state.kind === "missing"
      ? [div().text_size(12).text_color(t.muted).child("账本不存在"), div().text_size(11).text_color(t.dim).truncate().child(path), div().text_size(11).text_color(t.dim).child("监督方创建账本后，这里会列出待批条目。")]
      : state.kind === "error"
        ? [div().text_size(12).text_color(t.muted).child(`账本无法解析：${REASONS[state.reason] ?? state.reason}`), div().text_size(11).text_color(t.dim).truncate().child(path)]
        : [div().text_size(12).text_color(t.muted).child("没有待批条目")];
    const body = plan.shown.length ? plan.shown.map(r => this.approvalRow(r, t)) : [v_flex().p(10).gap(4).children(empty)];
    // 弹层是 fit-content：这里按内容长高，不用 size_full / flex_1 / 滚动容器。
    return v_flex().w_full().gap(6).p(10)
      .child(head)
      .children(body)
      .when(plan.pages > 1, el => el.child(h_flex().gap(6).items_center().px(2)
        .child(this.pageButton("上一页", plan.page > 0, t, () => { this.page = plan.page - 1; }))
        .child(div().flex_1().text_size(11).text_color(t.muted).child(`第 ${plan.page + 1}/${plan.pages} 页 · 共 ${rows.length} 条`))
        .child(this.pageButton("下一页", plan.page < plan.pages - 1, t, () => { this.page = plan.page + 1; }))))
      .child(h_flex().gap(6).items_center().px(2)
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).tooltip(path).child(path))
        .child(h_flex().h(20).px(6).items_center().rounded(5).cursor_pointer().bg(t.hover)
          .on_click((_e, cx) => { cx.stop_propagation(); this.openTarget(path); })
          .child(div().text_size(11).text_color(t.muted).child("在编辑器打开"))));
  }

  render() {
    const t = theme();
    if (props()?.approvals) return this.approvalsPanel(t);
    const space = spaces().find(p => p.active);
    // 收起的标签不渲染：固定待批标签 0 条时就在这里消失。
    const shown = filterVisibleTabs(space?.tabs ?? []);
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
      const pending = c.id === this.pendingTabId;
      return h_flex().id(`tab-${c.id}`).relative().h(29).px(8).gap(6).rounded(6).items_center().flex_none().text_size(12.5)
        .when(pending, el => el.min_w(72))
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .bg(c.active ? t.selected : t.chrome).text_color(c.active ? t.foreground : t.muted).when(c.active, el => el.font_medium())
        .when(!c.active, el => el.hover(s => s.bg(t.hover)))
        .when(c.active, el => el.child(div().absolute().left(6).right(6).bottom(0).h(2).rounded(1).bg(t.accent)))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          this.lastSwitchAt.set(space.id, Date.now());
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(statusIcon("working",t)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(statusIcon(c.status,t)))
        .when(pending && tabDot(this.localCount), el => el.child(div().size(6).rounded(3).bg(t.blocked)))
        .when(c.active && !pending, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
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
    const tabsRow = h_flex().size_full().min_w(0).px(12).pl(lightsPadding).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(button("sidebar-toggle", svg(side.icon).size(14), () => run(side.command, side.args)).tooltip(side.label))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(2).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "workbench-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/verified-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/verified-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/verified-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
    const errorLine = div().h(12).pl(lightsPadding).pr(12).text_size(10.5).text_color(t.muted)
      .when(Boolean(this.errorText), el => el.tooltip(this.errorText).child(this.errorText));
    return v_flex().size_full().min_w(0).child(tabsRow).child(errorLine);
  }
}
