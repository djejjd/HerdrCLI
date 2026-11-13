// 标签栏侧栏开关：只映射到 layout.toggle，方向随侧栏可见性变化。
import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarToggle } from '../mods/workbench-tabs/controls.js';

test('侧栏可见时按钮指向收起，且只调 layout.toggle', () => {
  const t = sidebarToggle({ children: [{ id: 'sidebar', hidden: false }] });
  assert.equal(t.command, 'layout.toggle');
  assert.deepEqual(t.args, { id: 'sidebar' });
  assert.equal(t.hidden, false);
  assert.match(t.icon, /chevron-left\.svg$/);
  assert.equal(t.label, '收起侧栏');
});

test('侧栏隐藏时按钮指向展开，命令不变', () => {
  const t = sidebarToggle({ children: [{ id: 'sidebar', hidden: true }] });
  assert.equal(t.command, 'layout.toggle');
  assert.equal(t.hidden, true);
  assert.match(t.icon, /chevron-right\.svg$/);
  assert.equal(t.label, '展开侧栏');
});

test('找不到 sidebar 节点时按可见处理，不另造状态', () => {
  const t = sidebarToggle({});
  assert.equal(t.hidden, false);
  assert.equal(t.command, 'layout.toggle');
  assert.deepEqual(t.args, { id: 'sidebar' });
});
