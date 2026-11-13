// layout 补丁测试：只加 notify-toast 与右下角 notify-float，保留其它字段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { patchLayout } from '../scripts/notify-layout.mjs';

const FLOAT = { id: 'notify-float', content: { mod: 'notify' }, edge: 'right', align: 'end', background: 'chrome' };
const base = {
  id: 'root', type: 'row', cloned_from: { name: 'main', version: '0.1.15' },
  children: [{ id: 'sidebar', type: 'column', children: [] }],
  theme: 'paper',
};

test('空 layout 加 toast 与 notify-float，不改其它字段', () => {
  const before = JSON.stringify(base);
  const out = patchLayout(base);
  assert.equal(out.toast, 'notify-toast');
  assert.deepEqual(out.floating, [FLOAT]);
  assert.deepEqual(out.children, base.children);
  assert.deepEqual(out.cloned_from, base.cloned_from);
  assert.equal(out.theme, 'paper');
  assert.equal(JSON.stringify(base), before);
});

test('补丁幂等：重复应用只留一个 notify-float', () => {
  const once = patchLayout(base);
  const twice = patchLayout(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.floating.filter(f => f.id === 'notify-float').length, 1);
});

test('保留其它 floating，清掉旧 pending-float', () => {
  const input = {
    ...base,
    toast: 'pending-toast',
    floating: [
      { id: 'board', content: { mod: 'board' }, edge: 'left', align: 'center' },
      { id: 'pending-float', content: { mod: 'pending' }, edge: 'right', align: 'end' },
    ],
  };
  const out = patchLayout(input);
  assert.equal(out.toast, 'notify-toast');
  assert.deepEqual(out.floating.map(f => f.id), ['board', 'notify-float']);
});

test('已有官方 toast 之外的第三方 toast 时拒绝覆盖', () => {
  assert.throws(() => patchLayout({ ...base, toast: 'my-toast' }), /toast/);
});

test('floating 不是数组时拒绝', () => {
  assert.throws(() => patchLayout({ ...base, floating: {} }), /floating/);
});
