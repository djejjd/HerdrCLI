import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, props, focused, terminals, exec, checking, appHome, openOverlay } from "herdr";

import { quotaSelection, quotaLines } from './model.js';

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.cards = [];
    this.stale = true;
    if (!props()?.details && !checking()) this.refreshTimer = cx.timer.every(1000, cx => this.refresh(cx));
  }

  close() {
    this.closed = true;
    this.refreshTimer?.cancel();
  }

  refresh(cx) {
    const address = focused()?.terminal ?? '';
    if (address !== this.address) {
      this.address = address;
      this.route = null;
      this.nextRead = 0;
      cx.notify();
    }
    if (this.busy || Date.now() < this.nextRead) return;
    this.busy = true;
    this.nextRead = Date.now() + 15000;
    cx.spawn(async cx => {
      try {
        const result = await exec('node', [appHome() + '/mods/magpie-status/read.mjs', address], {timeout:8500});
        if (result.code !== 0) throw new Error('quota read failed');
        const snapshot = JSON.parse(result.stdout);
        this.stale = !snapshot.cards;
        if (snapshot.cards) this.cards = snapshot.cards;
        if (address === this.address) this.route = snapshot.route;
      } catch { this.stale = true; }
      finally {
        this.busy = false;
        if (!this.closed) cx.notify();
      }
    });
  }

  detailPanel(t, data) {
    const panel = v_flex().size_full().px(14).py(10).gap(7).overflow_y_scrollbar()
      .bg(t.popover).text_color(t.foreground).text_size(12);
    const caption = text => div().text_color(t.muted).child(text);
    const draw = card => {
      const stamp = new Date(card.readAt ?? '');
      const row = v_flex().gap(3).child(div().font_semibold().child(card.alias || card.name || card.provider || '额度'));
      for (const line of quotaLines(card, true)) row.child(caption(line));
      if (card.error) row.child(caption('额度读取失败'));
      if (Number.isFinite(stamp.getTime())) row.child(caption('更新于 ' + stamp.toLocaleString()));
      return row;
    };
    panel.child(div().font_semibold().child('当前终端 · ' + data.model));
    for (const card of data.candidates) panel.child(draw(card));
    if (!data.candidates.length) panel.child(caption('当前终端的额度归属待确认'));
    panel.child(div().pt(5).font_semibold().child('其他模型与额度'));
    for (const card of data.others) panel.child(draw(card));
    if (!data.others.length) panel.child(caption('暂无其他额度'));
    if (data.stale) panel.child(caption('Magpie 暂不可用'));
    return panel;
  }

  quotaButton(t) {
    const address = focused()?.terminal;
    const terminal = terminals().find(item => item.address === address);
    const route = this.address === address ? this.route : null;
    const argv = terminal?.foreground?.argv ?? [];
    const flag = argv.indexOf('--model');
    const named = argv.find(arg => typeof arg === 'string' && arg.startsWith('--model='))?.slice(8);
    const model = route?.model || terminal?.report?.model || named || (flag >= 0 && argv[flag + 1]) || '模型待识别';
    const selection = quotaSelection(this.cards, route?.provider, route?.account);
    const lines = selection.current && !selection.current.error ? quotaLines(selection.current) : [];
    const summary = lines.length ? lines.join(' · ') : '查看额度';
    const data = {...selection, model, stale:this.stale};
    return div().id('magpie-quota').max_w(360).truncate().cursor_pointer().text_color(t.foreground)
      .tooltip('查看当前终端及其他模型额度')
      .on_click(() => openOverlay({mod:'magpie-status', kind:'popup', width:350, height:340, props:{details:data}}))
      .child(model + ' · ' + summary + (lines.length && this.stale ? '（缓存）' : '') + ' ▴');
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
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(this.quotaButton(t))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
