import {statusText} from './sidebar-policy.js';
// 待办视图：标题分段、行、空/错误/冲突态。只消费 todo.js 的视图模型。
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

// 统一 14px 细线图标：运行态中性，review 用 accent，needs_user 用提醒色，
// blocked/conflict 只用小图标承载错误色；行文字保持正常前景。
export function statusIcon(state, t) {
  if (state === "working" || state === "operation") {
    return svg("mods/workspace-chrome/spinner.svg").size(14).flex_none().text_color(t.muted).spin(900);
  }
  if (state === "needs_user") return svg("mods/agents-order/user.svg").size(14).flex_none().text_color(t.working);
  if (state === "review") return svg("mods/agents-order/review.svg").size(14).flex_none().text_color(t.accent);
  if (state === "blocked" || state === "conflict") return svg("mods/agents-order/blocked.svg").size(14).flex_none().text_color(t.blocked);
  return svg("mods/agents-order/idle.svg").size(14).flex_none().text_color(t.dim);
}

// 八个固定点沿方框依次点亮；由宿主动画驱动，隐藏时自动停止。
function squareActivity(t) {
  const points = [[0,0],[5,0],[10,0],[10,5],[10,10],[5,10],[0,10],[0,5]];
  return div().relative().size(13).flex_none().tooltip('运行中').children(points.map(([x,y], i) =>
    div().absolute().left(x).top(y).size(3).rounded_full().bg(t.border)
      .child(div().absolute().left(0).top(-5).text_size(10).text_color(t.foreground)
        .frames(points.map((_, step) => (step - i + points.length) % points.length < 3 ? '•' : ' '),125))));
}

// 将主题完成绿与次级文字色混合，让细勾在浅、深色侧栏中都柔和一些。
function completedTone(t) {
  if (![t.done, t.muted].every(c => /^#[0-9a-f]{6}$/i.test(c))) return t.done;
  const channel = (color, i) => parseInt(color.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map(i => Math.round(channel(t.done, i) * 0.4 + channel(t.muted, i) * 0.6)
    .toString(16).padStart(2, '0')).join('');
}

// 行尾轻提示使用同一笔画和字号；仅授权使用提醒色。
export function hintView(t, hint, count, open, compact = false) {
  const paths = { permission:"permission", reply:"reply", review:"review", idle:"idle", blocked:"blocked" };
  const busy = hint.icon === "working";
  const path = hint.icon === "completed" ? "mods/agents-order/completed.svg" : busy ? "mods/workspace-chrome/spinner.svg" : "mods/agents-order/" + paths[hint.icon] + ".svg";
  const icon = svg(path).size(hint.icon === "idle" ? 14 : 13).flex_none().text_color(hint.icon === "completed" ? completedTone(t) : hint.icon === "permission" ? t.working : t.muted);
  return h_flex().gap(3).flex_none().items_center()
    .when(!compact && count > 1, el => el.id("items-" + open.id).cursor_pointer().tooltip(statusText(hint.icon))
      .on_click((_e,cx) => { cx.stop_propagation(); open.show(cx); }))

    .when(!compact && Boolean(hint.text), el => el.child(div().text_size(12).text_color(t.muted).child(hint.text)))
    .child(h_flex().size(20).flex_none().items_center().justify_center().tooltip(statusText(hint.icon))
      .child(busy ? squareActivity(t) : hint.icon === "completed" ? icon.tooltip("本轮已完成") : icon));
}

export function modeHeader(t, detail, back, right) {
  return h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center().justify_between()
    .child(div().id("agents-heading").text_size(12).text_color(t.foreground)
      .when(detail, el => el.cursor_pointer().on_click((_e,cx) => back(cx)))
      .child(detail ? "‹ Agents" : "Agents"))
    .child(right);
}

export function todoRow(item, t, { selected, failure, onOpen }) {
  const bad = item.displayState === "conflict" || item.displayState === "invalid";
  const actionable = !bad && !item.legacy;
  const second = failure?.id === item.id || failure?.id === item.key
    ? failure.reason
    : item.conflict ? `冲突 ${item.conflictCount} 条，需监督方修正` : item.sourceLabel;
  return h_flex().id(`todo-${item.key}`).relative().h(30).flex_none().px(8).gap(9).rounded(8).items_center()
    .when(selected, el => el.bg(t.selected))
    .when(selected, el => el.child(div().absolute().left(0).top(7).bottom(7).w(2).rounded(1).bg(t.accent)))
    .when(!selected, el => el.hover(s => s.bg(t.hover)))
    .when(actionable, el => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); onOpen(item, cx); }))
    .tooltip(item.evidence ? `${item.sourceLabel} · ${item.evidence}` : item.sourceLabel)
    .child(statusIcon(item.displayState, t))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().min_w(0).truncate().text_size(12.5).line_height("14px")
        .text_color(t.foreground).child(item.title))
      .child(div().min_w(0).truncate().text_size(10.5).line_height("12px")
        .text_color(t.muted).child(second)))
    .when(item.conflict, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(`×${item.conflictCount}`)))
    .when(!actionable && !item.conflict, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child("只读")));
}

export function todoNotice(text, t, level = "dim") {
  return div().px(12).py(8).text_size(11.5).text_color(t.muted).child(text);
}

export function todoBody(t, state, selected, failure, onOpen, scroll) {
  const rows = (state?.items ?? []).map(item => todoRow(item, t, { selected, failure, onOpen }));
  const errors = state?.errors?.length ? todoNotice(`记录错误 ${state.errors.length} 条，需监督方修正`, t, "error") : null;
  const head = state?.kind === "loading" ? todoNotice("待办读取中…", t)
    : state?.kind === "missing" ? todoNotice("待办账本缺失，无法读取（不是 0 条）", t, "error")
      : state?.kind === "error" ? todoNotice("待办账本读取失败（不是 0 条）", t, "error")
        : state?.kind === "stale" ? [todoNotice("账本读取失败，显示上次结果", t, "error"), ...(errors ? [errors] : []), ...rows]
          : rows.length ? [ ...(errors ? [errors] : []), ...rows] : [ ...(errors ? [errors] : []), todoNotice("没有待办", t)];
  return v_flex().id("ag-list").flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always")
    .track_scroll(scroll)
    .children(Array.isArray(head) ? head : [head]);
}

export function todoRefreshIcon(t, action) {
  return div().id("todo-refresh").text_size(11).text_color(t.dim)
    .hover(s => s.text_color(t.foreground)).cursor_pointer().tooltip("重新读取待办账本")
    .on_click((_e, cx) => action(cx)).child(svg("mods/agents-order/refresh.svg").size(14));
}


