// 合并导航：折叠不动选择，空 Space 可达。
import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleFold, spaceSelectArgs, spaceHint, moveSpace, applyOrder } from '../mods/agent-workbench/nav.js';

test('折叠与选择分离：切换折叠不改动原集合', () => {
  const folded = new Set(['a']);
  const next = toggleFold(folded, 'b');
  assert.deepEqual([...folded], ['a']);
  assert.deepEqual([...next].sort(), ['a', 'b']);
  assert.deepEqual([...toggleFold(next, 'a')].sort(), ['b']);
});

test('选中 Space 只带 id，不夹带折叠状态', () => {
  assert.deepEqual(spaceSelectArgs({ id: 'sp1', active: true }), { id: 'sp1' });
});

test('空 Space 与仅 shell 的 Space 仍可进入', () => {
  assert.equal(spaceHint(0), '无 Agent');
  assert.equal(spaceHint(2), null);
  const active = 'sp1';
  toggleFold(new Set([active]), active);
  assert.equal(active, 'sp1');
});

test('项目上移下移只给相邻同机项目，索引从 1 起', () => {
  const spaces = [
    { id: 'a', machine: null }, { id: 'b', machine: null },
    { id: 'c', machine: 'm1' }, { id: 'd', machine: 'm1' },
  ];
  assert.deepEqual(moveSpace(spaces, 'b', -1), { id: 'b', index: 1 });
  assert.deepEqual(moveSpace(spaces, 'a', 1), { id: 'a', index: 2 });
  assert.equal(moveSpace(spaces, 'b', 1), null);
  assert.equal(moveSpace(spaces, 'c', -1), null);
  assert.deepEqual(moveSpace(spaces, 'c', 1), { id: 'c', index: 4 });
  assert.equal(moveSpace(spaces, 'a', -1), null);
  assert.equal(moveSpace(spaces, 'd', 1), null);
  assert.equal(moveSpace(spaces, 'nope', 1), null);
  assert.equal(moveSpace([{ id: 'only' }], 'only', 1), null);
});

test('松手预览按目标 ids 排，未列出的保留在末尾', () => {
  const list = [{ address: 'a' }, { address: 'b' }, { address: 'c' }];
  assert.deepEqual(applyOrder(list, ['c', 'a']).map(x => x.address), ['c', 'a', 'b']);
  assert.deepEqual(applyOrder(list, []).map(x => x.address), ['a', 'b', 'c']);
  assert.deepEqual(applyOrder(list, ['b']).map(x => x.address), ['b', 'a', 'c']);
});
