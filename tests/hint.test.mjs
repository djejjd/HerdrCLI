// 热区提示延时：600ms 才显示，离开/按下/销毁要取消。
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoverHint } from '../mods/agent-workbench/hint.js';

function scheduler() {
  const tasks = [];
  return {
    tasks,
    schedule(fn, ms) {
      const t = { fn, ms, canceled: false, cancel() { this.canceled = true; } };
      tasks.push(t); return t;
    },
  };
}
const fire = (t) => { if (!t.canceled) t.fn(); };

test('悬停到 600ms 才显示提示', () => {
  const s = scheduler(); let changes = 0;
  const h = new HoverHint({ schedule: s.schedule, delay: 600, onChange: () => changes++ });
  h.enter('t2');
  assert.equal(h.shown, null);
  assert.equal(s.tasks[0].ms, 600);
  fire(s.tasks[0]);
  assert.equal(h.shown, 't2');
  assert.equal(changes, 1);
});

test('离开会取消未到时的提示，已显示则收起', () => {
  const s = scheduler(); let changes = 0;
  const h = new HoverHint({ schedule: s.schedule, onChange: () => changes++ });
  h.enter('t2');
  h.leave();
  assert.equal(s.tasks[0].canceled, true);
  fire(s.tasks[0]);
  assert.equal(h.shown, null);
  h.enter('t3'); fire(s.tasks[1]);
  assert.equal(h.shown, 't3');
  h.leave();
  assert.equal(h.shown, null);
  assert.equal(changes, 2);
});

test('按下与销毁都立即隐藏并取消', () => {
  const s = scheduler();
  const h = new HoverHint({ schedule: s.schedule });
  h.enter('t2'); h.press();
  assert.equal(s.tasks[0].canceled, true);
  fire(s.tasks[0]);
  assert.equal(h.shown, null);
  h.enter('t2'); fire(s.tasks[1]); assert.equal(h.shown, 't2');
  h.close();
  assert.equal(h.shown, null);
});

test('同一热区重复进入不叠加计时器', () => {
  const s = scheduler();
  const h = new HoverHint({ schedule: s.schedule });
  h.enter('t2'); h.enter('t2');
  assert.equal(s.tasks.length, 1);
});

test('已显示后同一热区再进入不新增计时器也不重复通知', () => {
  const s = scheduler(); let changes = 0;
  const h = new HoverHint({ schedule: s.schedule, onChange: () => changes++ });
  h.enter('t2'); fire(s.tasks[0]);
  assert.equal(h.shown, 't2');
  assert.equal(changes, 1);
  h.enter('t2');
  assert.equal(s.tasks.length, 1);
  assert.equal(changes, 1);
});

test('切到新热点时旧提示立即收起', () => {
  const s = scheduler(); let changes = 0;
  const h = new HoverHint({ schedule: s.schedule, onChange: () => changes++ });
  h.enter('a'); fire(s.tasks[0]);
  assert.equal(h.shown, 'a');
  h.enter('b');
  assert.equal(h.shown, null);
  fire(s.tasks[1]);
  assert.equal(h.shown, 'b');
  assert.equal(changes, 3);
});
