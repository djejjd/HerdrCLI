// T-15 汇总窗口：本地日界、近 7 天含今天、无数据/部分数据/缓存。
import test from 'node:test';
import assert from 'node:assert/strict';
import { totals, cacheFresh } from '../mods/agent-workbench/usage.js';

const OFFSET = 480; // UTC+8
const at = (iso) => Date.parse(iso);
const rec = (iso, cny, session = 's1') => ({ at: at(iso), cny, session, source: 'dsh' });

test('本地日界：当天从本地 00:00 起算，前一天不计入 today', () => {
  const now = at('2026-11-13T16:30:00Z'); // 本地 11-14 00:30
  const r = totals([
    rec('2026-11-13T15:59:59Z', 1),  // 本地 11-13 23:59:59
    rec('2026-11-13T16:00:00Z', 2),  // 本地 11-14 00:00
  ], now, { offsetMinutes: OFFSET });
  assert.equal(r.today.cny, 2);
  assert.equal(r.week7.cny, 3);
});

test('近 7 天含今天：第 7 天 00:00 计入，再早 1ms 不计入', () => {
  const now = at('2026-11-13T16:30:00Z');
  const dayStart = at('2026-11-13T16:00:00Z');
  const r = totals([
    rec(new Date(dayStart - 6 * 864e5).toISOString(), 5),
    rec(new Date(dayStart - 6 * 864e5 - 1).toISOString(), 7),
  ], now, { offsetMinutes: OFFSET });
  assert.equal(r.week7.cny, 5);
});

test('会话只统计自己的 sessionKey，不混别的会话', () => {
  const now = at('2026-11-13T16:30:00Z');
  const r = totals([rec('2026-11-13T16:10:00Z', 3, 's1'), rec('2026-11-13T16:10:00Z', 9, 's2')], now, { offsetMinutes: OFFSET, sessionKey: 's1' });
  assert.equal(r.session.cny, 3);
  assert.equal(r.today.cny, 12);
  for (const k of ['session','today','week7']) {
    assert.ok('cny' in r[k] && 'source' in r[k] && 'reason' in r[k]);
  }
});

test('无数据返回 null 并说明；部分来源缺失写进 reason', () => {
  const now = at('2026-11-13T16:30:00Z');
  const empty = totals([], now, { offsetMinutes: OFFSET, sessionKey: 's1', missing: ['codex'] });
  assert.equal(empty.session.cny, null);
  assert.equal(empty.today.cny, null);
  assert.match(empty.today.reason, /codex/);
  const partial = totals([rec('2026-11-13T16:10:00Z', 1, 's1')], now, { offsetMinutes: OFFSET, sessionKey:'s1', missing:['codex'] });
  assert.equal(partial.session.reason, null);
  assert.match(partial.today.reason, /codex/);
  assert.equal(totals([], now, { offsetMinutes: OFFSET }).today.cny, null);
});

test('时区偏移：同一 UTC 时刻在不同本地时区落到不同 day', () => {
  const now = at('2026-11-13T16:30:00Z');
  const rows = [rec('2026-11-13T15:30:00Z', 4)];
  assert.equal(totals(rows, now, { offsetMinutes: 480 }).today.cny, null);   // 本地 11-13 23:30 → 不在 11-14
  assert.equal(totals(rows, now, { offsetMinutes: 0 }).today.cny, 4);       // UTC 11-13 15:30 在 11-13 当天
});

test('缓存 30s 命中/失效', () => {
  const now = 1_000_000;
  assert.equal(cacheFresh({ at: now - 29_000 }, now, 30_000), true);
  assert.equal(cacheFresh({ at: now - 30_000 }, now, 30_000), false);
  assert.equal(cacheFresh(null, now, 30_000), false);
  assert.equal(cacheFresh({ at: now + 1 }, now, 30_000), false);
});
