// 定价/汇率纯逻辑：未知不猜、缺价不归零、汇率带报价日。
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPricing, segmentByModel, recordCost } from '../mods/agent-workbench/pricing.js';
import { PRICE_TABLE } from '../mods/agent-workbench/price-table.js';
import { convertToCny, localDayKey, resolveFxRate } from '../mods/agent-workbench/fx.js';

const table = { entries: [
  { model:'deepseek-v4-flash', provider:'deepseek-official', currency:'CNY', input:2, cacheRead:0.2, cacheWrite:2, output:8, effectiveFrom:'2026-11-01', source:'deepseek' },
  { model:'same-model', provider:'gateway-a', currency:'USD', input:1, cacheRead:0.1, cacheWrite:1, output:2 },
  { model:'same-model', provider:'gateway-b', currency:'USD', input:3, cacheRead:0.3, cacheWrite:3, output:6 },
] };

test('provider 缺失或 universal 标记的边界', () => {
  const scopedOnly = { entries:[{ model:'m', provider:'gateway-a', input:1, cacheRead:0, cacheWrite:0, output:1, currency:'USD' }] };
  assert.equal(matchPricing('m', null, scopedOnly), null);
  assert.equal(matchPricing('m', 'gateway-a', scopedOnly).provider, 'gateway-a');
  const universal = { entries:[{ model:'m', universal:true, input:1, cacheRead:0, cacheWrite:0, output:1, currency:'USD' }] };
  assert.ok(matchPricing('m', null, universal));
});

test('模型是主键，provider 不符不套价，未知返回 null', () => {
  assert.ok(matchPricing('deepseek-v4-flash','deepseek-official',table));
  assert.equal(matchPricing('deepseek-v4-flash','other',table), null);
  assert.equal(matchPricing('same-model','gateway-b',table).input, 3);
  assert.equal(matchPricing('unknown-model','x',table), null);
  assert.equal(matchPricing('deepseek-v4-flash','deepseek-official',{entries:[]}), null);
});

test('模型切换按连续段分组', () => {
  const segs = segmentByModel([
    {model:'a',provider:'p'},{model:'a',provider:'p'},{model:'b',provider:'p'},{model:'a',provider:'p'},
  ]);
  assert.deepEqual(segs.map(s=>s.model), ['a','b','a']);
  assert.equal(segs[0].records.length, 2);
});

test('逐请求计价拆分缓存桶，缺字段不归零', () => {
  const r = recordCost({model:'deepseek-v4-flash',input:1_000_000,cacheRead:0,cacheWrite:0,output:0}, table.entries[0]);
  assert.equal(r.status,'ok'); assert.equal(r.amount, 2); assert.equal(r.currency,'CNY');
  const cached = recordCost({model:'deepseek-v4-flash',input:0,cacheRead:1_000_000,cacheWrite:0,output:0}, table.entries[0]);
  assert.equal(cached.amount, 0.2);
  const unknown = recordCost({model:'nope',input:1}, null);
  assert.equal(unknown.status,'unknown');
  assert.ok(!('amount' in unknown));
  const broken = recordCost({model:'x',input:1}, {currency:'USD',input:1});
  assert.equal(broken.status,'unknown');
  // 缺字段不能当成 0：必须显式给全四个桶。
  const missing = recordCost({model:'deepseek-v4-flash',input:1,output:0,cacheWrite:0}, table.entries[0]);
  assert.equal(missing.status,'unknown');
  const negative = recordCost({model:'deepseek-v4-flash',input:-1,output:0,cacheRead:0,cacheWrite:0}, table.entries[0]);
  assert.equal(negative.status,'unknown');
  const mismatch = recordCost({model:'deepseek-v4-flash',provider:'other',input:1,output:0,cacheRead:0,cacheWrite:0}, table.entries[0]);
  assert.equal(mismatch.status,'unknown');
});

test('汇率：CNY 不换算，USD 折 CNY 且标报价日', () => {
  const now = new Date('2026-11-13T12:00:00+08:00');
  const cny = convertToCny(10,'CNY',null,now);
  assert.equal(cny.converted,false); assert.equal(cny.amount,10);
  const usd = convertToCny(1,'USD',{rate:6.6683,quoteDate:'2026-11-12',source:'ECB/frankfurter'},now);
  assert.equal(usd.converted,true); assert.ok(Math.abs(usd.amount-6.6683)<1e-9);
  assert.equal(usd.fx.quoteDate,'2026-11-12'); assert.equal(usd.fx.stale,true);
  const today = convertToCny(1,'USD',{rate:7,quoteDate:localDayKey(now)},now);
  assert.equal(today.fx.stale,false);
  assert.equal(convertToCny(1,'USD',null,now).status,'unavailable');
});

test('缓存写 TTL 未知给区间并标 partial，已知按档位', () => {
  const entry = PRICE_TABLE.entries.find(e => e.model === 'gpt-6.1-sol');
  const base = { model:'gpt-6.1-sol', provider:'openai', input:0, cacheRead:0, output:0, cacheWrite:1_000_000 };
  const r = recordCost(base, entry);
  assert.equal(r.partial, true);
  assert.ok(r.range[0] < r.range[1]);
  assert.equal(r.range[0], 2.5); assert.equal(r.range[1], 5);
  const known = recordCost({ ...base, cacheWriteTtlMinutes:30 }, entry);
  assert.equal(known.amount, 2.5); assert.ok(!known.partial);
});

test('DeepSeek 峰谷按 UTC 工作日选价', () => {
  const entry = PRICE_TABLE.entries.find(e => e.model === 'deepseek-flash');
  const rec = { model:'deepseek-flash', provider:'deepseek-official', input:1_000_000, cacheRead:0, cacheWrite:0, output:0 };
  const peak = recordCost(rec, entry, Date.parse('2026-11-13T02:00:00Z')); // 周五 UTC
  const off = recordCost(rec, entry, Date.parse('2026-11-13T12:00:00Z'));
  assert.equal(peak.amount, 0.3);
  assert.equal(off.amount, 0.15);
  const weekend = recordCost(rec, entry, Date.parse('2026-11-14T02:00:00Z'));
  assert.equal(weekend.amount, 0.15);
});

test('内置价格条目带来源/日期且四桶可解释', () => {
  for (const e of PRICE_TABLE.entries) {
    assert.ok(e.model && e.provider && e.currency);
    assert.match(e.source, /^https:\/\//);
    assert.match(e.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
    const buckets = e.ratesOffPeak ? ['input','cacheRead','output'].every(k => typeof e.ratesOffPeak[k] === 'number')
      : ['input','cacheRead','output'].every(k => typeof e[k] === 'number');
    assert.ok(buckets);
    if (e.cacheWriteTiers) assert.ok(e.cacheWriteTiers.every(t => Number.isFinite(t.rate) && Number.isFinite(t.ttlMinutes)));
  }
});

test('汇率回退：当日缓存直返；直连失败走 curl；全失败用旧缓存或不可用', async () => {
  const now = new Date('2026-11-13T12:00:00+08:00');
  const todayCache = { date: localDayKey(now), rate: 7.1, quoteDate: '2026-11-13' };
  let called = 0;
  const hit = await resolveFxRate({ cache: todayCache, now, fetchJson: async () => { called++; return {}; } });
  assert.equal(hit.rate, 7.1); assert.equal(called, 0);

  const viaCurl = await resolveFxRate({ now,
    fetchJson: async () => { throw new Error('no proxy'); },
    curlJson: async () => ({ rate: 6.66, quoteDate: '2026-11-12', source: 'ECB/curl' }) });
  assert.equal(viaCurl.rate, 6.66); assert.equal(viaCurl.source, 'ECB/curl');

  const staleCache = { date: '2026-11-12', rate: 6.5, quoteDate: '2026-11-12' };
  const stale = await resolveFxRate({ cache: staleCache, now, fetchJson: async () => { throw new Error('x'); }, curlJson: async () => { throw new Error('y'); } });
  assert.equal(stale.stale, true); assert.equal(stale.rate, 6.5);

  const none = await resolveFxRate({ now, fetchJson: async () => { throw new Error('x'); }, curlJson: async () => { throw new Error('y'); } });
  assert.equal(none, null);
});
