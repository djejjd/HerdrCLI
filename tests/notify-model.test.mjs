// 「需要你介入」通知模型测试：只认 blocked/error、去重排序、系统通知、点击门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionLevel, displayName, reconcileItems, sortItems, visibleSlice,
  notificationFor, notificationKey, notificationGroup, safeTarget,
  hitBounds, pointInBounds, sameRect, clickGate,
} from '../mods/notify/model.js';

function term(address, label = null, name = null) {
  return { address, name, labels: label ? { 'workbench.name': label } : {} };
}
function agent(address, status, seq = 1, space_name = 'AIAgentCLI') {
  return { address, status, seq, space_name };
}
function item(overrides = {}) {
  return {
    target: 't16', level: 'blocked', seq: 1, since: 100,
    title: 'ds牛马3号(t16)', space: 'AIAgentCLI', ...overrides,
  };
}

test('只把 blocked/error 当介入，done/working/idle 全静默', () => {
  assert.equal(attentionLevel({ status: 'blocked' }), 'blocked');
  assert.equal(attentionLevel({ status: 'error' }), 'error');
  for (const status of ['done', 'working', 'idle', undefined]) {
    assert.equal(attentionLevel({ status }), null);
  }
  assert.equal(attentionLevel(null), null);
});

test('界面名优先，t 号只追加一次，程序名回落到会话', () => {
  assert.equal(displayName(term('t16', 'ds牛马3号'), 't16'), 'ds牛马3号(t16)');
  assert.equal(displayName(term('t16', 'ds牛马3号(t16)'), 't16'), 'ds牛马3号(t16)');
  assert.equal(displayName(term('t16', 'ds牛马3号（t16）'), 't16'), 'ds牛马3号（t16）');
  assert.equal(displayName(term('t1b', null, 'ds-task'), 't1b'), 'ds-task(t1b)');
  assert.equal(displayName(term('t2', null, 'codex'), 't2'), '会话(t2)');
  assert.equal(displayName(term('t2', null, 'DeepSeek Harness'), 't2'), '会话(t2)');
  assert.equal(displayName(null, 't9'), '会话(t9)');
});

test('reconcile 只建 blocked/error，按 target 去重并保留首次 since', () => {
  const terms = [term('t16', 'ds牛马3号'), term('t1c', 'ds牛马5号'), term('t5', 'done')];
  const agents = [agent('t16', 'blocked', 3), agent('t1c', 'error', 2), agent('t5', 'done', 1)];
  const r = reconcileItems([], agents, terms, 1000, {});
  assert.deepEqual(r.items.map(i => i.target).sort(), ['t16', 't1c']);
  assert.equal(r.items.find(i => i.target === 't16').since, 1000);
  assert.equal(r.items.find(i => i.target === 't1c').level, 'error');
  assert.equal(r.changed, true);
});

test('同会话 level 变化/seq 变化不重置 since，也不重复建项', () => {
  const prev = [item({ level: 'blocked', seq: 3, since: 100 })];
  const r = reconcileItems(prev, [agent('t16', 'error', 4)], [term('t16', 'ds牛马3号')], 2000, {});
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].level, 'error');
  assert.equal(r.items[0].since, 100);

  const r2 = reconcileItems(prev, [agent('t16', 'blocked', 5)], [term('t16', 'ds牛马3号')], 2000, {});
  assert.equal(r2.items[0].since, 100);
});

test('状态解除和终端消失都移除，并报告 removed', () => {
  const r = reconcileItems([item()], [agent('t16', 'working', 2)], [term('t16', 'ds牛马3号')], 2000, {});
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.removed, ['t16']);

  const r2 = reconcileItems([item()], [], [], 2000, {});
  assert.deepEqual(r2.items, []);
  assert.deepEqual(r2.removed, ['t16']);
});

test('dismissed 只压同 seq，新 seq 重新出现；缺终端仍显示会话', () => {
  const r = reconcileItems([], [agent('t16', 'blocked', 3)], [term('t16', 'ds牛马3号')], 1000, { t16: { seq: 3 } });
  assert.deepEqual(r.items, []);
  const r2 = reconcileItems([], [agent('t16', 'blocked', 4)], [term('t16', 'ds牛马3号')], 1000, { t16: { seq: 3 } });
  assert.equal(r2.items.length, 1);
  const r3 = reconcileItems([], [agent('t9', 'blocked', 1)], [], 1000, {});
  assert.equal(r3.items[0].title, '会话(t9)');
});

test('blocked 优先 error，同级按 since 升序', () => {
  const items = [
    item({ target: 'a', level: 'error', since: 1 }),
    item({ target: 'b', level: 'blocked', since: 3 }),
    item({ target: 'c', level: 'blocked', since: 2 }),
  ];
  const sorted = sortItems(items);
  assert.deepEqual(sorted.map(i => i.target), ['c', 'b', 'a']);
  assert.deepEqual(items.map(i => i.target), ['a', 'b', 'c']); // 不原地改
});

test('最多 3 条，剩余数正确', () => {
  assert.equal(visibleSlice([], 3).more, 0);
  assert.equal(visibleSlice([1, 2], 3).visible.length, 2);
  assert.equal(visibleSlice([1, 2, 3, 4, 5], 3).visible.length, 3);
  assert.equal(visibleSlice([1, 2, 3, 4, 5], 3).more, 2);
});

test('系统通知只在 inactive 发，标题正文用中文界面名', () => {
  assert.equal(notificationFor(item(), true), null);
  assert.equal(notificationFor(item(), undefined), null);
  const b = notificationFor(item({ level: 'blocked', title: 'ds牛马3号(t16)' }), false);
  assert.equal(b.title, 'ds牛马3号(t16) 需要你确认');
  assert.equal(b.body, '等待你在 Herdr 里确认');
  assert.equal(b.key, 't16:1');
  assert.equal(b.group, 'herdr-notify-t16');
  const e = notificationFor(item({ level: 'error', title: 'ds牛马5号(t1c)' }), false);
  assert.equal(e.title, 'ds牛马5号(t1c) 出错了，需要你处理');
  assert.equal(e.body, '点击回到该会话');
  assert.equal(notificationKey({ target: 't16', seq: 3 }), 't16:3');
  assert.equal(notificationGroup('vps/t16'), 'herdr-notify-vps_t16');
});

test('通知 target 只接受安全字符', () => {
  assert.equal(safeTarget('t16'), 't16');
  assert.equal(safeTarget('vps/t16'), 'vps/t16');
  assert.equal(safeTarget(''), null);
  assert.equal(safeTarget('t16; rm -rf /'), null);
  assert.equal(safeTarget('t16 2'), null);
});

test('按钮矩形命中与按下/抬起同框判断', () => {
  const b = { x: 100, y: 50, width: 48, height: 26 };
  assert.equal(hitBounds(b, { x: 0, y: 0 }), true);
  assert.equal(hitBounds(b, { x: 48, y: 26 }), true);
  assert.equal(hitBounds(b, { x: 49, y: 0 }), false);
  assert.equal(hitBounds(b, { x: -1, y: 0 }), false);
  assert.equal(hitBounds(null, { x: 0, y: 0 }), false);
  assert.equal(hitBounds(b, null), false);
  assert.equal(pointInBounds(b, { x: 100, y: 50 }), true);
  assert.equal(pointInBounds(b, { x: 148, y: 76 }), true);
  assert.equal(pointInBounds(b, { x: 149, y: 50 }), false);
  assert.equal(sameRect(b, { ...b }, 2), true);
  assert.equal(sameRect(b, { ...b, x: 103 }, 2), false);
});

test('clickGate：合法 mouse_up 唯一放行，缺一条都不行', () => {
  const base = {
    eventType: 'mouse_up', inRender: false, armed: true,
    pressTarget: 't16', target: 't16',
    pressAt: 1000, now: 1200, lastMoveAt: 1150,
    pressBounds: { x: 100, y: 50, width: 48, height: 26 },
    bounds: { x: 100, y: 50, width: 48, height: 26 },
    local: { x: 10, y: 10 }, position: { x: 110, y: 60 },
    visibleAge: 300, lastGoTarget: null, lastGoAt: 0,
  };
  assert.deepEqual(clickGate(base), { allow: true, reason: 'ok' });
  const cases = [
    [{ eventType: 'mouse_down' }, 'event'],
    [{ inRender: true }, 'in_render'],
    [{ armed: false }, 'not_armed'],
    [{ pressTarget: 't1c' }, 'press_mismatch'],
    [{ pressAt: -500 }, 'press_stale'],
    [{ lastMoveAt: -500 }, 'stale_pointer'],
    [{ bounds: null }, 'no_bounds'],
    [{ local: null }, 'no_bounds'],
    [{ position: null }, 'no_position'],
    [{ bounds: { x: 103, y: 50, width: 48, height: 26 } }, 'bounds_moved'],
    [{ visibleAge: 249 }, 'visible_too_new'],
    [{ local: { x: 49, y: 10 } }, 'outside'],
    [{ position: { x: 200, y: 60 } }, 'outside_window'],
    [{ lastGoTarget: 't16', lastGoAt: 1100 }, 'repeat'],
  ];
  for (const [patch, reason] of cases) {
    const r = clickGate({ ...base, ...patch });
    assert.equal(r.allow, false, reason);
    assert.equal(r.reason, reason);
  }
});
