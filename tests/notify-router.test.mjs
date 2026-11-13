// toast 路由测试：agent 介入通知吞掉，其它通知继续显示。
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSwallowToast } from '../mods/notify-toast/router.js';

test('agent blocked/error/done 通知都吞掉', () => {
  for (const level of ['warning', 'error', 'success', 'done', 'blocked']) {
    assert.equal(shouldSwallowToast({
      title: '任意', level, action: { name: 'agent.focus', args: { terminal: 't16' } },
    }), true);
  }
  assert.equal(shouldSwallowToast({
    level: 'error', action: { name: 'pane.focus', args: { pane: 'p1' } },
  }), true);
});

test('没有 target 的通知不吞：layout 错误、terminal.keep 失败', () => {
  assert.equal(shouldSwallowToast({ title: '布局加载失败', level: 'error' }), false);
  assert.equal(shouldSwallowToast({ title: '发送失败', body: 'terminal.keep 失败', level: 'error' }), false);
  assert.equal(shouldSwallowToast({ level: 'error' }), false);
});

test('非 agent 的普通 action 不吞', () => {
  assert.equal(shouldSwallowToast({
    title: '切换空间', level: 'info', action: { name: 'space.select', args: { id: 'sp1' } },
  }), false);
  assert.equal(shouldSwallowToast(null), false);
  assert.equal(shouldSwallowToast(undefined), false);
});
