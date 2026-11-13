// 费用行格式化：切 key 不闪旧值、非法金额不归零、部分记录可读。
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUsage } from '../mods/agent-workbench/usage.js';

test('无状态或 idle 不渲染', () => {
  assert.equal(formatUsage(null, true), null);
  assert.equal(formatUsage({ status:'idle' }, true), null);
});

test('切 key 时只显示读取中，不显示旧金额', () => {
  const r = formatUsage({ status:'ready', cny:12.34 }, false);
  assert.equal(r.kind, 'loading');
  assert.ok(!r.text.includes('12.34'));
});

test('cny 为 null/NaN/负数不归零也不显示 NaN', () => {
  for (const cny of [null, NaN, -1, 'x']) {
    const r = formatUsage({ status:'ready', cny }, true);
    assert.equal(r.kind, 'unknown');
    assert.ok(!r.text.includes('NaN'));
    assert.ok(!r.text.includes('¥0.00'));
  }
});

test('partial 带区间、报价日与价格来源', () => {
  const r = formatUsage({
    status:'partial', cny:5, rangeCny:[5, 8],
    original:{ amount:0.75, currency:'USD' },
    fx:{ rate:6.6683, quoteDate:'2026-11-12', stale:true },
    coverage:{ complete:false, from:'2026-11-13T12:00:00Z' },
    priceSource:'https://api-docs.deepseek.com/quick_start/pricing', priceFetchedAt:'2026-11-13',
    reasons:['缓存写 TTL 未知'],
  }, true);
  assert.equal(r.kind, 'partial');
  assert.match(r.text, /¥5\.00–8\.00（部分）/);
  assert.match(r.tooltip, /报价日 2026-11-12，非当日/);
  assert.match(r.tooltip, /价格来源/);
  assert.match(r.tooltip, /缓存写 TTL 未知/);
});

test('unknown 兼容 reasons 数组与单个 reason', () => {
  const a = formatUsage({ status:'unknown', reason:'缺少会话 ID', reasons:['缺少会话 ID'] }, true);
  assert.equal(a.text, '无法估价：缺少会话 ID');
  const b = formatUsage({ status:'unknown', reason:'x' }, true);
  assert.match(b.tooltip, /x/);
});
