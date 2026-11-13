// 解压失败路径：超限/超时/错误都要 kill 且只 settle 一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readZstd } from '../mods/agent-workbench/zstd-reader.js';

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = (sig) => { child.killed = sig; child.emit('close'); };
  return { child, spawned: [] };
}

test('正常读取完成并 close 一次', async () => {
  const { child, spawned } = fakeSpawn();
  const p = readZstd('/x', { spawn: () => { spawned.push(child); return child; } });
  child.stdout.emit('data', Buffer.from('{"a":1}\n{"a":2}\n'));
  child.emit('close');
  const r = await p;
  assert.equal(r.truncated, false);
  assert.equal(r.records, 2);
  assert.match(r.text, /"a":1/);
});

test('超过字节上限 kill 并标 truncated', async () => {
  const { child } = fakeSpawn();
  const p = readZstd('/x', { spawn: () => child, caps: { maxBytes: 4 } });
  child.stdout.emit('data', Buffer.from('12345\n'));
  const r = await p;
  assert.equal(r.truncated, true);
  assert.equal(r.reason, 'bytes');
  assert.equal(child.killed, 'SIGKILL');
});

test('超过记录数上限 kill', async () => {
  const { child } = fakeSpawn();
  const p = readZstd('/x', { spawn: () => child, caps: { maxRecords: 1 } });
  child.stdout.emit('data', Buffer.from('a\nb\n'));
  const r = await p;
  assert.equal(r.truncated, true);
  assert.equal(r.reason, 'records');
  assert.equal(child.killed, 'SIGKILL');
});

test('超时 kill 且只 settle 一次', async () => {
  const { child } = fakeSpawn();
  const p = readZstd('/x', { spawn: () => child, caps: { timeoutMs: 5 } });
  await new Promise(r => setTimeout(r, 15));
  const r = await p;
  assert.equal(r.truncated, true);
  assert.equal(r.reason, 'timeout');
  child.emit('close'); child.emit('error', new Error('late'));
  assert.equal(r.truncated, true);
});

test('spawn 抛错/缺 spawn 不崩', async () => {
  const a = await readZstd('/x', { spawn: () => { throw new Error('boom'); } });
  assert.equal(a.reason, 'boom');
  const b = await readZstd('/x', {});
  assert.match(b.reason, /spawn/);
});
