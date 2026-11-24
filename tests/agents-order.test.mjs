import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedGroup, orderedBySpace, reorderGroup, dragDecision, releaseTime, dropIndex, rowCenters, projectedPositions, persistOrder } from '../mods/agents-order/order.js';

const group = [
  { address: 'a', space: 'one', pinned: false },
  { address: 'b', space: 'one', pinned: false },
  { address: 'c', space: 'one', pinned: false },
];

test('saved ranks survive status changes; unranked agents keep their model order', () => {
  const changed = [{ ...group[0], status: 'blocked' }, { ...group[1], status: 'idle' }, group[2]];
  assert.deepEqual(orderedGroup(changed, { a: '1', b: '0' }).map(a => a.address), ['b', 'a', 'c']);
  assert.deepEqual(orderedGroup(changed, { a: 'bad', b: '0' }).map(a => a.address), ['b', 'a', 'c']);
});

test('saved ranks never reorder pinned agents or mix Spaces', () => {
  const list = [
    { address: 'pin-a', space: 'one', pinned: true },
    { address: 'a', space: 'one' },
    { address: 'b', space: 'one' },
    { address: 'pin-b', space: 'two', pinned: true },
    { address: 'c', space: 'two' },
  ];
  const ranks = { 'pin-a': '9', a: '2', b: '0', 'pin-b': '0', c: '1' };
  assert.deepEqual(orderedBySpace(list, ['one', 'two'], ranks).map(a => a.address),
    ['pin-a', 'pin-b', 'b', 'a', 'c']);
});

test('drag changes only unpinned agents in its own space', () => {
  assert.deepEqual(reorderGroup(group, 'a', 2), ['b', 'c', 'a']);
  assert.equal(reorderGroup([...group, { address: 'other', space: 'two' }], 'a', 2), null);
  assert.equal(reorderGroup([...group.slice(0, 1), { ...group[1], pinned: true }], 'a', 1), null);
  assert.equal(reorderGroup(group, 'missing', 1), null);
});

test('short press focuses; canceled or unchanged drag never writes order', () => {
  assert.equal(dragDecision({ dy: 4, origin: 0, target: 1, valid: true }), 'focus');
  assert.equal(dragDecision({ dy: 31, origin: 0, target: 1, valid: true }), 'reorder');
  assert.equal(dragDecision({ dy: 31, origin: 0, target: 1, valid: false }), 'cancel');
  assert.equal(dragDecision({ dy: 31, origin: 0, target: 0, valid: true }), 'noop');
});

test('ordinary mouse release cannot suppress the next quick Agent click', () => {
  const initial = 0;
  assert.equal(1100 - releaseTime(null, initial, 1000) > 300, true);
  assert.equal(1100 - releaseTime({ address: 'a' }, initial, 1000) > 300, false);
});

test('expanded children shift subsequent row centers, not the origin row', () => {
  assert.deepEqual(rowCenters(1, 71, [1, 1, 0]), [15, 71, 127]);
  assert.deepEqual(rowCenters(0, 15, [2, 0]), [15, 97]);
});

test('drop uses actual row centers, including room taken by expanded child rows', () => {
  assert.equal(dropIndex(72, [15, 71, 127]), 1);
  assert.equal(dropIndex(104, [15, 71, 127]), 2);
  assert.equal(dropIndex(-100, [15, 71, 127]), 0);
  assert.equal(dropIndex(1000, [15, 71, 127]), 2);
});

test('drag preview makes room for a whole agent block, including expanded children', () => {
  const offsets = projectedPositions(group, 'a', 2, { a: 30, b: 56, c: 30 });
  assert.deepEqual(Object.fromEntries(offsets), { b: 0, c: 56, a: 86 });
});

test('failed label write restores earlier writes and identifies the failure stage', async () => {
  const labels = new Map([['a', '2'], ['b', '0'], ['c', '1']]);
  const writes = [];
  const result = await persistOrder(['c', 'a', 'b'], Object.fromEntries(labels), async (id, rank) => {
    writes.push([id, rank]);
    if (id === 'a' && rank === '1') throw new Error('offline');
    labels.set(id, rank);
  });
  assert.deepEqual(result, { ok: false, failedAt: 'a', rollbackFailed: [] });
  assert.deepEqual([...labels], [['a', '2'], ['b', '0'], ['c', '1']]);
  assert.deepEqual(writes, [['c', '0'], ['a', '1'], ['c', '1']]);
});

test('rollback failure remains visible instead of claiming restored order', async () => {
  const result = await persistOrder(['a', 'b'], { a: '1', b: '0' }, async (id, rank) => {
    if ((id === 'b' && rank === '1') || (id === 'a' && rank === '1')) throw new Error('offline');
  });
  assert.deepEqual(result, { ok: false, failedAt: 'b', rollbackFailed: ['a'] });
});

test('统一树的拖动命中与包含间距、虚拟子行的实际块高度一致', () => {
  assert.deepEqual(rowCenters(1, 101, [2, 0, 1], 34), [15, 101, 135]);
});

test('底栏显隐规则与独立侧栏运行时一致', async () => {
  const sidebar = await import('../mods/agents-order/sidebar-policy.js');
  const footer = await import('../mods/session-footer/fee.js');
  for (const address of [null, 't1', 't2']) {
    for (const program of [null, 'CODEX', 'claude', 'omp', 'opencode', 'dsh-tui', 'zsh']) {
      const inputs = [address, [{address:'t2'}], program];
      assert.equal(sidebar.showFooter(...inputs), footer.showFooter(...inputs));
    }
  }
});

test('长列表跨越和反向查找遵循相邻行中点，比较次数按对数增长', () => {
  const centers = Array.from({length:8192}, (_, index) => index * 34 + 15);
  let reads = 0;
  const counted = new Proxy(centers, {get(target, key) {
    if (/^\d+$/.test(String(key))) reads++;
    return target[key];
  }});
  for (const index of [8190, 120, 4000, 3]) {
    assert.equal(dropIndex(centers[index] + 17, counted), index + 1);
    assert.equal(dropIndex(centers[index] + 16.99, counted), index);
  }
  assert.ok(reads <= 8 * 28, `坐标读取 ${reads} 次`);
});
