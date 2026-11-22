import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, props, focused, terminals, exec, layout, checking, appHome, openOverlay } from "herdr";

import { showFooter } from './fee.js';
import { footerReadings, quotaSelection, quotaReadings, modelReadingKey, rememberModelReading, resetLabel } from './model.js';

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.cards = [];
    this.modelReadings = new Map();
    this.stale = true;
    if (!props()?.details && !checking()) this.refreshTimer = cx.timer.every(1000, cx => this.refresh(cx));
  }

  close() {
    this.closed = true;
    this.refreshTimer?.cancel();
  }

  refresh(cx) {
    const address = focused()?.terminal ?? '';
    const terminal = terminals().find(item => item.address === address);
    const visible = showFooter(address,agents(),terminal?.foreground?.name);
    if (this.visible !== visible) {
      this.visible = visible;
      run(visible ? 'layout.show' : 'layout.hide', {id:'status'});
    }
    if (!visible) return;
    const key = modelReadingKey(terminal);
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
      try {
        const result = await exec('node', [appHome() + '/mods/session-footer/read.mjs', address], {timeout:14000});
        if (result.code !== 0) throw new Error('quota read failed');
        const snapshot = JSON.parse(result.stdout);
        this.stale = !snapshot.cards;
        if (snapshot.cards) this.cards = snapshot.cards;
        if (!snapshot.route) this.modelReadings.delete(key);
        rememberModelReading(this.modelReadings, key, snapshot.route);
      } catch { this.stale = true; }
      finally {
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
      const reset = details ? resetLabel(reading.reset) : '';
      if (reset) row.child(div().flex_1())
        .child(div().text_color(t.dim).tooltip('重置时间').child(reset));
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
      const heading = cardName(current);
      panel.child(caption(heading));
      const readings = quotaReadings(current).slice(0, 2);
      for (const reading of readings) panel.child(this.readingsView(t, [reading], true));
      if (!readings.length) panel.child(caption('暂无读数'));
    } else if (related.length) {
      for (const card of related) panel.child(compactRow(card));
    } else panel.child(caption('暂无匹配额度'));
    const others = data.others;
    if (others.length) {
      panel.child(div().mt(3).pt(6).border_t(1).border_color(t.border).text_color(t.muted).child('其他额度'));
      for (const card of others) panel.child(compactRow(card));
    }
    if (data.stale) panel.child(caption('Magpie 离线 · 缓存'));
    return panel;
  }

  quotaButton(t) {
    const address = focused()?.terminal;
    const terminal = terminals().find(item => item.address === address);
    const route = this.modelReadings.get(modelReadingKey(terminal));
    const argv = terminal?.foreground?.argv ?? [];
    const flag = argv.indexOf('--model');
    const named = argv.find(arg => typeof arg === 'string' && arg.startsWith('--model='))?.slice(8);
    const model = route?.model || terminal?.report?.model || named || (flag >= 0 && argv[flag + 1]) || '';
    const selection = quotaSelection(this.cards, route?.provider, route?.account);
    const card = selection.current ?? selection.reference;
    const readings = card ? footerReadings(card) : [];
    const data = {...selection, model:model || '当前终端', stale:this.stale};
    return h_flex().id('magpie-quota').max_w(440).min_w(0).gap(6).items_center().cursor_pointer()
      .tooltip(selection.reference ? '额度来源：' + (card.alias || card.name || card.provider) : '查看当前终端及其他模型额度')
      .on_click(() => openOverlay({mod:'magpie-status', kind:'popup', width:330, height:Math.min(380, 110 + this.cards.length * 23), props:{details:data}}))
      .when(Boolean(model), el => el.child(div().min_w(0).truncate().text_color(t.muted).child(model)))
      .when(model && Number.isFinite(route?.cost), el => el.child(div().text_color(t.dim).child('·')))
      .when(Number.isFinite(route?.cost), el => el.child(div().text_color(t.foreground).child('本会话约 $' + route.cost.toFixed(2))))
      .when((model || Number.isFinite(route?.cost)) && readings.length, el => el.child(div().text_color(t.dim).child('·')))
      .when(readings.length, el => el.child(this.readingsView(t, readings).flex_none()))
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
    return h_flex().size_full().px(14).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.8).text_color(t.muted).child(this.quotaButton(t));
  }
}
