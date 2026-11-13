// 静态守卫：浮层只读，唯一跳转在系统通知点击脚本里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const main = read('mods/notify/main.js');
const sh = read('mods/notify/focus.sh');
const toast = read('mods/notify-toast/main.js');

test('主浮层不包含任何跳转：没有 run/agent.focus/clickGate/handleUp', () => {
  assert.match(main, /const GO_ENABLED = false/);
  assert.ok(!/\brun\s*\(/.test(main));
  assert.ok(!/agent\.focus/.test(main));
  assert.ok(!/clickGate|handleUp|handleDown|verifyGo/.test(main));
  assert.ok(!/space\.select|tab\.select|pane\.focus/.test(main));
  assert.ok(!/open\s+-a/.test(main));
});

test('浮层没有 on_click、键盘激活或请求焦点', () => {
  assert.ok(!/on_click/.test(main));
  assert.ok(!/on_key_down|on_key_up|on_action|request_focus|focusable|tab_index|key_context|\.focus\(\)/.test(main));
});

test('只读浮层用 mouse_down/up 处理 ×/收起/展开', () => {
  assert.match(main, /controlDown\(e, 'dismiss'/);
  assert.match(main, /controlUp\(e, 'dismiss'/);
  assert.match(main, /on_mouse_up\('left'/);
  assert.match(main, /child\('×'\)/);
});

test('-activate 只在通知参数里出现一次', () => {
  assert.equal((main.match(/-activate/g) || []).length, 1);
  assert.match(main, /-activate[\s\S]{0,40}HERDR_BUNDLE/);
});

test('render 期间有 in_render 标记，事件日志读它', () => {
  assert.match(main, /this\.inRender\s*=\s*true/);
  assert.match(main, /this\.inRender\s*=\s*false/);
  assert.match(main, /in_render:\s*this\.inRender/);
});

test('点击日志带 event/modifiers/focus', () => {
  assert.match(main, /modifiers:/);
  assert.match(main, /focus:\s*focused\(\)/);
  assert.match(main, /event:\s*type/);
});

test('浮层只用现有 theme token，不写死颜色', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(main));
  assert.match(main, /\.bg\(t\.chrome\)/);
  assert.match(main, /t\.hover/);
  assert.match(main, /t\.border/);
  assert.match(main, /t\.foreground/);
  assert.match(main, /t\.muted/);
  assert.match(main, /t\.accent/);
});

test('focus.sh 是唯一 agent.focus 路径，FOCUS_ENABLED=1', () => {
  assert.match(sh, /FOCUS_ENABLED=1/);
  assert.match(sh, /\[ "\$FOCUS_ENABLED" = "1" \]/);
  assert.match(sh, /agent\.focus --terminal/);
  assert.match(sh, /click-ok/);
  assert.match(sh, /click-failed/);
  assert.ok(!/-activate/.test(sh));
  assert.ok(!/open\s+-a/.test(sh));
  assert.match(sh, /notify-click\.log/);
});

test('toast fork 先判断 shouldSwallowToast', () => {
  assert.match(toast, /shouldSwallowToast/);
  assert.match(toast, /closeOverlay/);
  assert.ok(!/open\s+-a/.test(toast));
});
