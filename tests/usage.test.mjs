// 用量解析测试：重复快照、缓存桶、模型切换、compact 分代、Claude 去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageTokens, parseCodexEvents, claudeUsage, cumulativeOk, matchSessionFile, newCodexState, feedCodex, summarizeCodex, cacheInvalid, consumedBytes } from '../mods/agent-workbench/usage.js';

const tok = (i, o, cached = 0, written = 0) => ({ input_tokens: i + cached + written, output_tokens: o, cached_input_tokens: cached, cache_write_input_tokens: written });
const ev = (total, last, model, ts = '2026-11-13T10:00:00Z') => ({ timestamp: ts, payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last }, ...(model ? {} : {}) } });

test('Codex 输入拆成未命中/缓存读/缓存写，reasoning 不另加', () => {
  assert.deepEqual(usageTokens(tok(100, 20, 30, 5)), { input: 100, output: 20, cacheWrite: 5, cacheRead: 30 });
  assert.equal(usageTokens({ input_tokens: 10, output_tokens: 1, cached_input_tokens: 20 }), null);
});

test('重复累计快照只记一次，逐请求段可累加', () => {
  const events = [
    ev(tok(10, 2), tok(10, 2), 'm'),
    ev(tok(10, 2), tok(10, 2), 'm'),      // 重复快照
    ev(tok(15, 3), tok(5, 1), 'm'),
  ];
  const r = parseCodexEvents(events);
  assert.equal(r.segments.length, 2);
  assert.equal(r.complete, true);
  assert.equal(r.covered, 12 + 6);
});

test('累计回退（compact/恢复）开新分代，后续同值可再记', () => {
  const events = [
    ev(tok(10, 2), tok(10, 2), 'm'),
    ev(tok(2, 1), tok(2, 1), 'm'),        // 回退
    ev(tok(2, 1), tok(2, 1), 'm'),        // 新分代里重复
  ];
  const r = parseCodexEvents(events);
  assert.equal(r.generation, 1);
  assert.equal(r.segments.filter(s => s.generation === 1).length, 1);
});

test('分段不覆盖最终累计时标不完整', () => {
  const events = [ev(tok(10, 2), tok(10, 2), 'm'), ev(tok(20, 4), tok(5, 1), 'm')];
  const r = parseCodexEvents(events);
  assert.equal(r.complete, false);
});

test('Claude 消息 usage 拆分，缺字段返回 null', () => {
  const m = { model: 'deepseek-v4-flash', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 5 } };
  assert.deepEqual(claudeUsage(m), { at: null, model: 'deepseek-v4-flash', input: 10, output: 2, cacheWrite: 5, cacheRead: 30 });
  assert.equal(claudeUsage({ usage: { input_tokens: '10', output_tokens: 2 } }), null);
});

test('DSH 多天会话必须是累计递增，否则口径不一致', () => {
  assert.equal(cumulativeOk([{at:1,input:10,output:2},{at:2,input:15,output:3}]), true);
  assert.equal(cumulativeOk([{at:2,input:15},{at:1,input:20}]), false);
  assert.equal(cumulativeOk([{at:1,input:20},{at:2,input:15}]), false);
  assert.equal(cumulativeOk([]), false);
});

test('会话文件只按精确 ID 匹配，不靠时间', () => {
  const paths=['/x/rollout-a-111.jsonl','/x/rollout-b-222.jsonl','/x/222.jsonl'];
  assert.deepEqual(matchSessionFile(paths,'111'),['/x/rollout-a-111.jsonl']);
  assert.deepEqual(matchSessionFile(paths,'222'),['/x/rollout-b-222.jsonl','/x/222.jsonl']);
  assert.deepEqual(matchSessionFile(paths,null),[]);
});

test('turn_context 顶层 type 也能取到模型', () => {
  const events = [
    { type:'turn_context', payload:{ model:'gpt-6.1-sol' } },
    ev(tok(10,2), tok(10,2), 'm'),
  ];
  const r = parseCodexEvents(events);
  assert.equal(r.segments[0].model, 'gpt-6.1-sol');
});

test('全量解析与分批追加结果一致', () => {
  const all = [ev(tok(10,2), tok(10,2), 'm'), ev(tok(15,3), tok(5,1), 'm'), ev(tok(25,5), tok(10,2), 'm')];
  const full = parseCodexEvents(all);
  const st = newCodexState();
  feedCodex(st, all.slice(0,1)); feedCodex(st, all.slice(1));
  const inc = summarizeCodex(st);
  assert.deepEqual(inc.segments, full.segments);
  assert.equal(inc.complete, full.complete);
  assert.equal(inc.generation, full.generation);
});

test('缓存身份/截断检测与尾行字节推进', () => {
  assert.equal(cacheInvalid(null,'a',{ino:1,size:5}), true);
  assert.equal(cacheInvalid({version:1,path:'a',inode:1,offset:5},'a',{ino:1,size:6}), false);
  assert.equal(cacheInvalid({version:1,path:'a',inode:1,offset:5},'a',{ino:2,size:6}), true);
  assert.equal(cacheInvalid({version:1,path:'a',inode:1,offset:5},'a',{ino:1,size:4}), true);
  assert.equal(consumedBytes(0, 'abc\nxyz'), 4);
  assert.equal(consumedBytes(10, 'no-newline'), null);
});
