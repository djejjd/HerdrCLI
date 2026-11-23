import test from 'node:test';
import assert from 'node:assert/strict';
import { completionIcon } from '../mods/agents-order/completion-read.js';

test('运行时先收到完成记录，退出运行时仍能消费', () => {
  const state = {};
  const packet = {parentState:'completed',parentRevision:2};
  const icon = (status, now, packet) => completionIcon(state,{status,now,packet,focused:true});
  assert.equal(icon('working',0),'working');
  assert.equal(icon('working',1,packet),'working');
  assert.equal(icon('idle',2),'completed');
  assert.equal(icon('idle',60002,packet),'idle');
});

test('查看满一分钟后才收到同轮记录，保持空闲', () => {
  const state = {};
  const icon = (status,now,packet) => completionIcon(state,{status,now,packet,focused:true});
  assert.equal(icon('done',0),'completed');
  assert.equal(icon('idle',60000),'idle');
  assert.equal(icon('idle',61000,{parentState:'completed',parentRevision:3}),'idle');
});

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
  assert.equal(icon('idle', 151002, false, packet), 'idle');
  assert.equal(icon('idle', 151003, true, {...packet,parentRevision:102}), 'completed');
});

test('启动后等待首条消息时恢复空闲，开始处理时再次显示运行中', () => {
  const state = {};
  const icon = status => completionIcon(state, {status, now:0, focused:true});
  assert.equal(icon('working'), 'working');
  assert.equal(icon('idle'), 'idle');
  assert.equal(state.deadline, null);
  assert.equal(icon('working'), 'working');
});
