import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, props, focused, terminals, exec, checking, appHome, openOverlay } from "herdr";

import { quotaSelection, quotaReadings, modelReadingKey, rememberModelReading } from './model.js';

// 只展示固定短语，避免把子进程响应中的自由文本带进弹窗。
const failureStages = new Map([
  ['worker', '额度读取进程'], ['quota', '额度'], ['terminal', '本地终端'],
  ['codex-process', 'Codex 进程'], ['codex-session', 'Codex 主会话'],
  ['session', '终端会话'], ['route', '路由'], ['omp-model', 'OMP 模型'],
]);
const failureReasons = new Map([
  ['timeout', '读取超时'], ['invalid-response', '响应无效'], ['not-found', '尚未确认'],
  ['http-error', '服务响应失败'], ['unavailable', '读取失败'],
]);

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.cards = [];
    this.modelReadings = new Map();
    this.quotaFailures = [];
    this.routeFailures = [];
    this.stale = true;
    if (!props()?.details && !checking()) this.refreshTimer = cx.timer.every(1000, cx => this.refresh(cx));
  }

  close() {
    this.closed = true;
    this.refreshTimer?.cancel();
  }

  refresh(cx) {
    const address = focused()?.terminal ?? '';
    const key = modelReadingKey(terminals().find(terminal => terminal.address === address));
    if (address !== this.address || key !== this.readingKey) {
      this.address = address;
      this.readingKey = key;
      this.nextRead = 0;
      cx.notify();
    }
    if (this.busy || Date.now() < this.nextRead) return;
    this.busy = true;
    this.nextRead = Date.now() + 15000;
    cx.spawn(async cx => {
      let reason = 'unavailable';
      try {
        // 给本地身份检查、会话回退和随后路由查询留出各自的超时时间。
        const result = await exec('node', [appHome() + '/mods/magpie-status/read.mjs', address], {timeout:12000});
        if (result.code !== 0) throw new Error('quota read failed');
        reason = 'invalid-response';
        const snapshot = JSON.parse(result.stdout);
        if (!snapshot || (snapshot.cards !== null && !Array.isArray(snapshot.cards))) throw new Error('invalid quota response');
        this.stale = !snapshot.cards;
        if (snapshot.cards) this.cards = snapshot.cards;
        const failures = Array.isArray(snapshot.failures) ? snapshot.failures
          .filter(item => failureStages.has(item?.stage) && failureReasons.has(item.reason))
          .map(({stage, reason}) => ({stage, reason})) : [];
        this.quotaFailures = failures.filter(item => item.stage === 'quota');
        this.routeFailures = failures.filter(item => item.stage !== 'quota');
        rememberModelReading(this.modelReadings, key, snapshot.route);
      } catch {
        this.stale = true;
        this.quotaFailures = [{stage:'worker', reason}];
        this.routeFailures = [];
      }
      finally {
        this.failureAddress = address;
        this.failureKey = key;
        this.busy = false;
        if (!this.closed) cx.notify();
      }
    });
  }

  readingsView(t, readings, details = false) {
    const row = h_flex().gap(4).items_center().text_color(t.muted);
    readings.forEach((reading, index) => {
      if (index) row.child(div().text_color(t.dim).child('·'));
      row.child(div().child(reading.label))
        .child(div().text_color(reading.low ? t.blocked : t.foreground)
          .when(reading.low, el => el.font_semibold()).child(reading.value));
      const reset = new Date(reading.reset ?? '');
      if (details && Number.isFinite(reset.getTime())) {
        row.child(div().text_color(t.dim).child(reset.toLocaleString() + ' 重置'));
      }
    });
    return row;
  }

  detailPanel(t, data) {
    const panel = v_flex().size_full().px(14).py(10).gap(7).overflow_y_scrollbar()
      .bg(t.popover).text_color(t.foreground).text_size(12);
    const caption = text => div().text_color(t.muted).child(text);
    const cardName = card => card.alias || card.name || card.provider || '额度';
    const compactRow = card => {
      const readings = quotaReadings(card).slice(0, 2);
      return h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().child(cardName(card)))
        .child(readings.length ? this.readingsView(t, readings) : caption('暂无读数'));
    };
    panel.child(div().font_semibold().child(data.model));
    const related = data.candidates;
    const current = data.current ?? data.reference;
    if (current) {
      const heading = cardName(current) + (data.current ? '' : ' · 关联订阅');
      panel.child(caption(heading));
      const readings = quotaReadings(current).slice(0, 2);
      for (const reading of readings) panel.child(this.readingsView(t, [reading], true));
      if (!readings.length) panel.child(caption('暂无读数'));
    } else if (related.length) {
      panel.child(caption('关联账号'));
      for (const card of related) panel.child(compactRow(card));
    } else panel.child(caption('当前模型暂无匹配额度'));
    const others = data.others;
    if (others.length) {
      panel.child(div().mt(3).pt(6).border_t(1).border_color(t.border).text_color(t.muted).child('其他额度'));
      for (const card of others) panel.child(compactRow(card));
    }
    if (data.stale && data.hasCards) panel.child(caption('显示额度缓存'));
    for (const {stage, reason} of data.failures ?? []) {
      if (failureStages.has(stage) && failureReasons.has(reason)) {
        const suffix = stage === 'worker' && reason === 'unavailable' ? '失败' : failureReasons.get(reason);
        panel.child(caption(failureStages.get(stage) + suffix));
      }
    }
    return panel;
  }

  quotaButton(t) {
    const address = focused()?.terminal;
    const terminal = terminals().find(item => item.address === address);
    const key = modelReadingKey(terminal);
    const route = this.modelReadings.get(key);
    const argv = terminal?.foreground?.argv ?? [];
    const flag = argv.indexOf('--model');
    const named = argv.find(arg => typeof arg === 'string' && arg.startsWith('--model='))?.slice(8);
    const model = route?.model || terminal?.report?.model || named || (flag >= 0 && argv[flag + 1]) || '';
    const selection = quotaSelection(this.cards, route?.provider, route?.account);
    const card = selection.current ?? selection.reference;
    const readings = card ? quotaReadings(card).slice(0, 2) : [];
    const routeFailures = address === this.failureAddress && key === this.failureKey ? this.routeFailures : [];
    const data = {...selection, model:model || '当前终端', stale:this.stale, hasCards:this.cards.length > 0,
      failures:[...this.quotaFailures, ...routeFailures]};
    return h_flex().id('magpie-quota').max_w(440).min_w(0).gap(6).items_center().cursor_pointer()
      .tooltip(selection.reference ? '额度来源：' + (card.alias || card.name || card.provider) : '查看当前终端及其他模型额度')
      .on_click(() => openOverlay({mod:'magpie-status', kind:'popup', width:330, height:Math.min(380, 150 + this.cards.length * 23), props:{details:data}}))
      .when(Boolean(model), el => el.child(div().min_w(0).truncate().text_color(t.muted).child(model)))
      .child(readings.length ? this.readingsView(t, readings).flex_none() : div().text_color(t.dim).child('额度'))
      .when(Boolean(readings.length && this.stale), el => el.child(div().text_color(t.dim).child('缓存')))
      .child(div().text_color(t.dim).child('▴'));

  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    if (props()?.details) return this.detailPanel(t, props().details);
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(this.quotaButton(t))
      .when(Boolean(space?.machine), el => el.child(label("server", space.machine)))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
