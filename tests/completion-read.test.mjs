import test from 'node:test';
import assert from 'node:assert/strict';
import {completionIcon} from '../mods/agents-order/completion-read.js';

test('没有状态包时 working 转 idle 会清除旧运行提示', () => {
  const state = {};
  assert.equal(completionIcon(state, {status:'working', now:1, focused:false}), 'working');
  assert.equal(completionIcon(state, {status:'idle', now:2, focused:false}), 'idle');
});

test('完成提示仍可在 idle 后保留给用户阅读', () => {
  const state = {};
  completionIcon(state, {status:'working', now:1, focused:false});
  assert.equal(completionIcon(state, {status:'done', now:2, focused:true}), 'completed');
  assert.equal(completionIcon(state, {status:'idle', now:3, focused:true}), 'completed');
});
