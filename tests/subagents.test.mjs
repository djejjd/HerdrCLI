// 后台子 agent：无 pane、父在本 Space、live；只读排序，不写 workbench.order。
import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundRows, backgroundName, backgroundStatus, backgroundAction, rowSelected, backgroundRow } from '../mods/agent-workbench/subagents.js';

const agents = [
  { address: 't19', space: 's1', name: 'ds-管', program: { name: 'DeepSeek' } },
  { address: 't15', space: 's1', name: 'ds-visual', program: { name: 'DeepSeek' } },
  { address: 't7', space: 's2', name: 'Codex', program: { name: 'Codex' } },
];

const terminals = [
  { address: 't19', state: 'live' },
  { address: 't1b', parent: 't19', state: 'live', name: null, argv: ['dsh-tui', '--name', 'ds-verify'], status: 'working', labels: {} },
  { address: 't1c', parent: 't19', state: 'live', name: 'ds-focus', status: { state: 'idle' }, labels: { 'workbench.name': '显式名' } },
  { address: 't1d', parent: 't19', state: 'live', name: 'with-pane', status: 'working' },
  { address: 't1e', parent: 't7', state: 'live', name: 'other-space' },
  { address: 't1f', parent: 'dead', state: 'live', name: 'dead-parent' },
  { address: 't1g', parent: 't19', state: 'exited', name: 'dead-terminal' },
  { address: 't1h', parent: 't19', state: 'live', name: 'label', labels: { 'workbench.name': 'label-name' }, argv: ['dsh-tui', '--name', 'argv-name'] },
  { address: 't1i', parent: 't19', state: 'live', name: 'ordered', labels: { 'workbench.order': '0' } },
];

test('后台行只收 live、父在本 Space、无 pane 的 terminal', () => {
  const rows = backgroundRows(terminals, agents, 's1', [{ terminal: 't1d' }]);
  assert.deepEqual(rows.map(r => r.address).sort(), ['t1b', 't1c', 't1h', 't1i']);
  assert.equal(rows.find(r => r.address === 't1e'), undefined, '父在别的 Space');
  assert.equal(rows.find(r => r.address === 't1f'), undefined, '父已不在');
  assert.equal(rows.find(r => r.address === 't1d'), undefined, '已有 pane');
  assert.equal(rows.find(r => r.address === 't1g'), undefined, '非 live');
});

test('名字优先 workbench.name，再 name，再 argv --name，最后地址', () => {
  assert.equal(backgroundName(terminals[1]), 'ds-verify');
  assert.equal(backgroundName(terminals[2]), '显式名');
  assert.equal(backgroundName(terminals[7]), 'label-name');
  assert.equal(backgroundName({ address: 't9x', argv: ['dsh-tui', '--name=eq-name'] }), 'eq-name');
  assert.equal(backgroundName({ address: 't9y' }), 't9y');
});

test('status 兼容 plain word 与对象，无状态为 null', () => {
  assert.equal(backgroundStatus(terminals[1]), 'working');
  assert.equal(backgroundStatus(terminals[2]), 'idle');
  assert.equal(backgroundStatus({ address: 't9z' }), null);
});

test('点击动作：有 focused pane 用 terminal.show，否则 peek', () => {
  assert.deepEqual(backgroundAction(terminals[1], true), { name: 'terminal.show', args: { terminal: 't1b' } });
  assert.deepEqual(backgroundAction(terminals[1], false), { name: 'terminal.peek', args: { terminal: 't1b' } });
  assert.equal(backgroundAction(null, true), null);
});

test('后台行不写/不新增 workbench.order，不混入普通 agent 顺序', () => {
  const rows = backgroundRows(terminals, agents, 's1', [{ terminal: 't1d' }]);
  assert.equal(rows.find(r => r.address === 't1i').order, undefined);
  assert.deepEqual(backgroundRows(terminals, agents, 's2', []).map(r => r.address), ['t1e']);
});

test('shown 存在时普通行不再选中，后台行仍按 shown 选中', () => {
  assert.equal(rowSelected({ focused: true }, null), true);
  assert.equal(rowSelected({ focused: true }, 't1f'), false);
  assert.equal(rowSelected({ focused: true }, 't1f', true), true);
  assert.equal(rowSelected({ focused: false }, null), false);
});

test('后台行第一行取程序名、图标来自 program，父名只进 tooltip', () => {
  const row = backgroundRow({
    address:'t1b', name:'ds牛马四号', parent:'t16',
    program:{ name:'DeepSeek Harness', icon:'icons/dsh.svg', tint:true },
  }, '牛马主(代理)');
  assert.equal(row.program, 'DeepSeek Harness');
  assert.equal(row.icon, 'icons/dsh.svg');
  assert.equal(row.tint, true);
  assert.equal(row.name, 'ds牛马四号');
  assert.match(row.tooltip, /牛马主\(代理\)/);
  assert.doesNotMatch(row.program, /后台|牛马主/);
});

test('后台行缺 program 时不伪造图标，任务名仍优先工作台名', () => {
  const row = backgroundRow({ address:'t1b', labels:{'workbench.name':'脚本'}, name:'zsh' }, '父');
  assert.equal(row.icon, null);
  assert.equal(row.program, 'Agent');
  assert.equal(row.name, '脚本');
});

test('后台行图标以父 agent 的 program 为准，terminal.program 只取名字', () => {
  const row = backgroundRow(
    { address:'t1b', name:'ds-notify', program:{ name:'DeepSeek Harness' } },
    '牛马主(代理)',
    { name:'DeepSeek Harness', icon:'icons/dsh.svg', tint:true },
  );
  assert.equal(row.icon, 'icons/dsh.svg');
  assert.equal(row.tint, true);
  assert.equal(row.program, 'DeepSeek Harness');
  assert.equal(row.name, 'ds-notify');
});
