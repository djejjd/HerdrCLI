// 「需要你介入」右下角只读浮层：只显示 blocked/error，不提供任何跳转按钮。
// 跳转唯一来源是用户点击 macOS 系统通知（focus.sh）；浮层内的 × 只忽略/已读。
import { View, div } from 'gpui-kit';
import { v_flex, h_flex } from 'gpui-base';
import {
  agents, terminals, theme, exec, shared, setShared, focused,
  placement, window, appHome, readTextFile, writeTextFile,
} from 'herdr';
import {
  reconcileItems, sortItems, visibleSlice, notificationFor,
  safeTarget, hitBounds, sameRect,
} from './model.js';

const TICK_MS = 500;
const MAX_ROWS = 3;
const CARD_W = 360;
const PAD = 8;
const HEADER_H = 20;
const ROW_H = 40;
const GAP = 4;
const FOOTER_H = 14;
const CLOSE_W = 24;
const BTN_H = 26;
const VISIBLE_MS = 250;
const LOG_MAX = 64 * 1024;
const LOG_NAME = 'notify-events.log';
const NOTIFIER = '/opt/homebrew/bin/terminal-notifier';
const HERDR_BUNDLE = 'dev.herdr.app';

// 浮层不提供跳转。保留标记，明确这里是只读视图。
const GO_ENABLED = false;

function elemId(prefix, target) {
  return `${prefix}-${String(target ?? '').replace(/[^A-Za-z0-9_.-]/g, '_')}`;
}

function appleString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function trim(value, n = 120) {
  return String(value ?? '').slice(0, n);
}

export default class Notify extends View {
  init(_p, cx) {
    this.closed = false;
    this.items = [];
    this.visible = [];
    this.more = 0;
    this.collapsed = false;
    this.controlPress = null;
    this.renderSeq = 0;
    this.renderAt = 0;
    this.inRender = false;
    this.visibleSince = new Map();
    this.rootSize = null;
    this.cardSince = 0;
    this.lastFocus = null;
    this.lastFocusSnap = null;
    this.lastItems = '';
    this.logQueue = Promise.resolve();
    this.logFail = 0;
    this.timer = cx.timer.every(TICK_MS, cx2 => this.tick(cx2));
    this.tick(cx);
  }

  close() {
    this.closed = true;
    this.timer?.cancel?.();
    this.timer = null;
    this.controlPress = null;
  }

  tick(cx) {
    if (this.closed) return;
    const now = Date.now();
    const allAgents = agents() ?? [];
    const allTerms = terminals() ?? [];
    const prev = Array.isArray(shared('notify.items')) ? shared('notify.items') : [];
    const disRaw = shared('notify.dismissed');
    const dis = disRaw && typeof disRaw === 'object' && !Array.isArray(disRaw) ? disRaw : {};
    const had = this.items.length > 0;
    const result = reconcileItems(prev, allAgents, allTerms, now, dis);
    this.items = sortItems(result.items);
    const { visible, more } = visibleSlice(this.items, MAX_ROWS);
    this.updateVisibleSince(visible, now);
    this.visible = visible;
    this.more = more;
    if (this.items.length && !had) this.cardSince = now;
    if (!this.items.length) {
      this.cardSince = 0;
      this.collapsed = false;
      this.controlPress = null;
    }
    if (result.changed) setShared('notify.items', result.items);
    this.pruneDismissed(dis, allAgents);
    for (const target of result.removed) this.removeNotification(target);
    this.maybeNotify(now, allAgents);
    this.auditFocus();
    const sig = JSON.stringify(this.items);
    if (sig !== this.lastItems) {
      this.lastItems = sig;
      cx.notify();
    }
  }

  updateVisibleSince(visible, now) {
    const next = new Map();
    for (const it of visible) next.set(it.target, this.visibleSince.get(it.target) ?? now);
    this.visibleSince = next;
  }

  pruneDismissed(dis, allAgents) {
    let next = {};
    let dirty = false;
    for (const [target, entry] of Object.entries(dis)) {
      const ag = allAgents.find(a => a.address === target);
      const seq = ag && Number.isFinite(Number(ag.seq)) ? Number(ag.seq) : null;
      if (ag && seq !== null && Number(entry?.seq) === seq) next[target] = entry;
      else dirty = true;
    }
    const entries = Object.entries(next);
    if (entries.length > 50) {
      next = Object.fromEntries(entries.slice(-50));
      dirty = true;
    }
    if (dirty) setShared('notify.dismissed', next);
  }

  maybeNotify(now, allAgents) {
    if (window()?.active !== false) return;
    const raw = shared('notify.sent');
    const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    let dirty = false;
    for (const it of this.items) {
      if (sent[it.target]?.seq === it.seq) continue;
      const msg = notificationFor(it, false);
      if (!msg) continue;
      const arg = safeTarget(it.target);
      if (!arg) {
        sent[it.target] = { seq: it.seq, at: now, state: 'skipped' };
        dirty = true;
        this.log('notify-skip', { target: it.target });
        continue;
      }
      sent[it.target] = { seq: it.seq, at: now, group: msg.group, state: 'sending' };
      dirty = true;
      this.sendNotification(it, msg, arg);
    }
    for (const [target, entry] of Object.entries(sent)) {
      const ag = allAgents.find(a => a.address === target);
      const activeItem = this.items.some(i => i.target === target);
      if ((!ag && !activeItem) || (!activeItem && now - (entry?.at ?? 0) > 600000)) {
        delete sent[target];
        dirty = true;
      }
    }
    if (dirty) setShared('notify.sent', sent);
  }

  sendNotification(it, msg, arg) {
    try {
      const script = `${appHome()}/mods/notify/focus.sh`;
      const command = `/bin/sh "${script}" ${arg}`;
      const args = [
        '-title', msg.title, '-message', msg.body, '-group', msg.group,
        '-activate', HERDR_BUNDLE, '-execute', command,
      ];
      exec(NOTIFIER, args, { timeout: 10000 }).then((r) => {
        if (r.code === 0) {
          this.markSent(it.target, it.seq, 'ok');
          this.log('notify-ok', { target: it.target, group: msg.group });
        } else {
          this.fallback(it, msg, r);
        }
      }).catch((err) => this.fallback(it, msg, err));
    } catch (err) {
      this.fallback(it, msg, err);
    }
  }

  fallback(it, msg, cause) {
    this.log('notify-fallback', {
      target: it.target,
      code: cause?.code ?? null,
      error: trim(cause?.stderr ?? cause?.message ?? cause),
    });
    try {
      exec('terminal-notifier', ['-title', msg.title, '-message', msg.body, '-group', msg.group], { timeout: 8000 })
        .then((r) => {
          if (r.code === 0) {
            this.markSent(it.target, it.seq, 'fallback');
            this.log('notify-fallback-ok', { target: it.target });
          } else {
            this.appleFallback(it, msg);
          }
        })
        .catch(() => this.appleFallback(it, msg));
    } catch {
      this.appleFallback(it, msg);
    }
  }

  appleFallback(it, msg) {
    const script = `display notification ${appleString(msg.body)} with title ${appleString(msg.title)}`;
    try {
      exec('/usr/bin/osascript', ['-e', script], { timeout: 8000 }).then((r) => {
        const state = r.code === 0 ? 'fallback' : 'failed';
        this.markSent(it.target, it.seq, state);
        this.log(state === 'fallback' ? 'notify-apple-ok' : 'notify-failed', { target: it.target });
      }).catch((err) => {
        this.markSent(it.target, it.seq, 'failed');
        this.log('notify-failed', { target: it.target, error: trim(err?.message ?? err) });
      });
    } catch (err) {
      this.markSent(it.target, it.seq, 'failed');
      this.log('notify-failed', { target: it.target, error: trim(err?.message ?? err) });
    }
  }

  markSent(target, seq, state) {
    const raw = shared('notify.sent');
    const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const cur = sent[target];
    if (!cur || Number(cur.seq) !== Number(seq)) return;
    sent[target] = { ...cur, seq: Number(seq), state, at: Date.now() };
    setShared('notify.sent', sent);
  }

  removeNotification(target) {
    const raw = shared('notify.sent');
    const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const cur = sent[target];
    if (!cur) return;
    if (cur.group) {
      try {
        exec(NOTIFIER, ['-remove', cur.group], { timeout: 5000 }).catch(() => {});
      } catch {}
    }
    delete sent[target];
    setShared('notify.sent', sent);
    this.log('notify-remove', { target });
  }

  auditFocus() {
    const f = focused();
    const snap = f ? {
      space: f.space, tab: f.tab, pane: f.pane, terminal: f.terminal, shown: f.shown, agent: f.agent,
    } : null;
    const key = JSON.stringify(snap);
    if (this.lastFocus === null) {
      this.lastFocus = key;
      this.lastFocusSnap = snap;
      this.log('focus-initial', { focus: snap });
      return;
    }
    if (key !== this.lastFocus) {
      this.log('focus-change', { from: this.lastFocusSnap, to: snap });
      this.lastFocus = key;
      this.lastFocusSnap = snap;
    }
  }

  controlDown(e, control, it, cx) {
    cx.stop_propagation();
    this.controlPress = {
      control,
      target: it?.target ?? null,
      at: Date.now(),
      bounds: e?.bounds ? { ...e.bounds } : null,
    };
    this.log('down', { ...this.eventInfo(e, it, 'mouse_down'), control });
  }

  controlUp(e, control, it, cx) {
    cx.stop_propagation();
    const now = Date.now();
    const p = this.controlPress;
    this.controlPress = null;
    const sameTarget = (p?.target ?? null) === (it?.target ?? null);
    const ready = p && p.control === control && sameTarget
      && Number.isFinite(p.at) && now - p.at <= 1500
      && sameRect(p.bounds, e?.bounds, 2)
      && hitBounds(e?.bounds, e?.local_position);
    if (!ready) {
      this.log('control-blocked', { ...this.eventInfo(e, it, 'mouse_up'), control, reason: 'gate' });
      return;
    }
    if (control === 'expand') {
      this.expand(cx);
      return;
    }
    if (control === 'collapse') {
      if (now - (this.cardSince || now) < VISIBLE_MS) {
        this.log('control-blocked', { ...this.eventInfo(e, it, 'mouse_up'), control, reason: 'visible_too_new' });
        return;
      }
      this.collapse(cx);
      return;
    }
    if (now - (this.visibleSince.get(it.target) ?? now) < VISIBLE_MS) {
      this.log('control-blocked', { ...this.eventInfo(e, it, 'mouse_up'), control, reason: 'visible_too_new' });
      return;
    }
    this.dismiss(it.target, 'close', cx);
  }

  collapse(cx) {
    this.collapsed = true;
    this.controlPress = null;
    this.visibleSince.clear();
    this.log('collapse', {});
    cx.notify();
  }

  expand(cx) {
    this.collapsed = false;
    this.controlPress = null;
    this.visibleSince.clear();
    this.cardSince = Date.now();
    this.log('expand', {});
    cx.notify();
  }

  dismiss(target, source, cx) {
    const item = this.items.find(i => i.target === target);
    const ag = (agents() ?? []).find(a => a.address === target);
    const seq = ag && Number.isFinite(Number(ag.seq)) ? Number(ag.seq) : (item?.seq ?? -1);
    const raw = shared('notify.dismissed');
    const dis = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const rawItems = Array.isArray(shared('notify.items')) ? shared('notify.items') : [];
    this.items = this.items.filter(i => i.target !== target);
    this.visible = this.visible.filter(i => i.target !== target);
    this.more = Math.max(0, this.items.length - MAX_ROWS);
    this.visibleSince.delete(target);
    this.controlPress = null;
    this.removeNotification(target);
    dis[target] = { seq, at: Date.now() };
    setShared('notify.dismissed', dis);
    setShared('notify.items', rawItems.filter(i => i.target !== target));
    this.log('dismiss', { target, source, seq });
    cx.notify();
  }

  eventInfo(e, it, type) {
    return {
      event: type,
      target: it?.target ?? null,
      level: it?.level ?? null,
      button: e?.button ?? null,
      click_count: e?.click_count ?? null,
      modifiers: e?.modifiers ?? null,
      position: e?.position ?? null,
      local: e?.local_position ?? null,
      bounds: e?.bounds ?? null,
      press_bounds: this.controlPress?.bounds ?? null,
      root_size: this.rootSize,
      placement: placement(),
      render_seq: this.renderSeq,
      render_age: Date.now() - (this.renderAt || 0),
      visible_age: it ? Date.now() - (this.visibleSince.get(it.target) ?? Date.now()) : null,
      in_render: this.inRender === true,
      focus: focused(),
    };
  }

  log(kind, extra = {}) {
    if (this.closed) return;
    const line = `${JSON.stringify({ t: Date.now(), kind, ...extra })}\n`;
    this.logQueue = this.logQueue.then(async () => {
      try {
        const path = `${appHome()}/${LOG_NAME}`;
        const snapshot = await readTextFile(path);
        const cur = snapshot ?? '';
        let text = cur + line;
        if (text.length > LOG_MAX) {
          const at = text.indexOf('\n', text.length - LOG_MAX);
          text = at >= 0 ? text.slice(at + 1) : text.slice(-LOG_MAX);
        }
        await writeTextFile(path, text, snapshot);
      } catch {
        this.logFail += 1;
      }
    });
  }

  render(cx) {
    this.inRender = true;
    this.renderSeq += 1;
    this.renderAt = Date.now();
    const t = theme();
    try {
      if (!this.items.length) return div().id('notify').w(0).h(0);
      if (this.collapsed) return this.collapsedView(t);
      return this.cardView(t);
    } finally {
      this.inRender = false;
    }
  }

  cardView(t) {
    const children = [this.headerView(t)];
    for (const it of this.visible) children.push(this.rowView(it, t));
    if (this.more > 0) children.push(this.footerView(t));
    return v_flex().id('notify').bg(t.chrome).w(CARD_W).px(PAD).py(PAD).gap(GAP)
      .on_size_change((size, _cx) => { this.rootSize = size; })
      .children(children);
  }

  headerView(t) {
    return h_flex().id('notify-header').h(HEADER_H).w_full().px(10).gap(6)
      .items_center().border_b_1().border_color(t.border)
      .child(div().w(3).h(14).rounded(2).bg(t.blocked))
      .child(div().text_size(11).font_semibold().text_color(t.muted).child('需要你介入'))
      .child(div().text_size(11).font_semibold().text_color(t.blocked).child(String(this.items.length)))
      .child(div().flex_1())
      .child(div().id('notify-collapse').text_size(10.5).text_color(t.muted).cursor_pointer().hover(h => h.bg(t.hover))
        .on_mouse_down('left', (e, cx) => {
          cx.stop_propagation();
          this.controlDown(e, 'collapse', null, cx);
        })
        .on_mouse_up('left', (e, cx) => {
          cx.stop_propagation();
          this.controlUp(e, 'collapse', null, cx);
        })
        .child('收起'));
  }

  rowView(it, t) {
    const meta = `${it.space ? `${it.space} · ` : ''}${it.level === 'error' ? '执行出错' : '等待确认'}`;
    return h_flex().id(elemId('notify-row', it.target)).h(ROW_H).w_full().px(10).gap(8)
      .items_center().rounded(8).bg(t.chrome)
      .child(div().w(2).h(18).rounded(1).bg(t.blocked))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).truncate().child(it.title))
        .child(div().text_size(10.5)
          .text_color(it.level === 'error' ? t.blocked : t.muted)
          .truncate().child(meta)))
      .child(div().id(elemId('notify-dismiss', it.target)).w(CLOSE_W).h(BTN_H).flex_none()
        .items_center().justify_center().rounded(6).cursor_pointer().hover(h => h.bg(t.hover))
        .tooltip('忽略 / 已读')
        .on_mouse_down('left', (e, cx) => {
          cx.stop_propagation();
          this.controlDown(e, 'dismiss', it, cx);
        })
        .on_mouse_up('left', (e, cx) => {
          cx.stop_propagation();
          this.controlUp(e, 'dismiss', it, cx);
        })
        .child(div().text_size(14).text_color(t.muted).child('×')));
  }

  footerView(t) {
    return h_flex().id('notify-footer').h(FOOTER_H).w_full().px(10).items_center()
      .border_t_1().border_color(t.border)
      .child(div().text_size(10.5).text_color(t.accent).child(`还有 ${this.more} 条`))
      .child(div().flex_1())
      .child(div().text_size(10.5).text_color(t.muted).child(`共 ${this.items.length} 条`));
  }

  collapsedView(t) {
    return h_flex().id('notify').w(168).h(34).px(10).gap(8).items_center()
      .rounded(8).bg(t.chrome).border_1().border_color(t.border)
      .on_size_change((size, _cx) => { this.rootSize = size; })
      .child(div().w(3).h(14).rounded(2).bg(t.blocked))
      .child(div().text_size(11).font_semibold().text_color(t.foreground)
        .child(`需要你介入 ${this.items.length}`))
      .child(div().flex_1())
      .child(div().id('notify-expand').text_size(10.5).text_color(t.muted).cursor_pointer().hover(h => h.bg(t.hover))
        .on_mouse_down('left', (e, cx) => {
          cx.stop_propagation();
          this.controlDown(e, 'expand', null, cx);
        })
        .on_mouse_up('left', (e, cx) => {
          cx.stop_propagation();
          this.controlUp(e, 'expand', null, cx);
        })
        .child('展开'));
  }
}
