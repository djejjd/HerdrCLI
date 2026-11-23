import test from 'node:test';
import assert from 'node:assert/strict';
import { completionIcon } from '../mods/agents-order/completion-read.js';

test('后台完成直到首次查看，切走后仍在六十秒边界恢复空闲', () => {
  const state = {};
  const icon = (status, now, focused = false, packet) => completionIcon(state, {status, now, focused, packet});
  assert.equal(icon('working', 0), 'working');
  assert.equal(icon('done', 1), 'completed');
  assert.equal(icon('idle', 90000), 'completed');
  assert.equal(icon('idle', 91000, true), 'completed');
  const packet = {parentState:'completed', parentRevision:101};
  assert.equal(icon('idle', 150999, false, packet), 'completed');
  assert.equal(icon('idle', 151000, false, packet), 'idle');
  assert.equal(icon('working', 151001, false, packet), 'working');
  assert.equal(icon('idle', 151002, false, packet), 'working');
  assert.equal(icon('idle', 151003, true, {...packet,parentRevision:102}), 'completed');
});
