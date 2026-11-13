// 视觉格式纯逻辑：完整分支断点、额度指标组、费用金额；不读写终端状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchText, branchTokens, quotaGroups, feeAmount, feeLabel, FOOTER_H, footerHeight, quotaLineKind, feeSegments, feeTooltip, resetHint, quotaTooltip, silentState, hasValue } from '../mods/agent-workbench/visual.js';

test('branchText 只在斜杠/连字符后插零宽断点，保留原文', () => {
  const raw = 'feature/agent-workbench-visual-redesign';
  const out = branchText(raw);
  assert.equal(out.replace(/\u200B|\u2060/g, ''), raw);
  assert.ok(out.includes('\u2060/\u200B'));
  assert.ok(out.includes('\u2060-\u200B'));
  assert.equal(branchText('main'), 'main');
  assert.equal(branchText(null), '');
});

test('branchTokens 把分隔符留在前一块，供 flex-wrap 使用', () => {
  assert.deepEqual(branchTokens('feature/agent-workbench'), ['feature/', 'agent-', 'workbench']);
  assert.deepEqual(branchTokens('a//b'), ['a/', '/', 'b']);
  assert.deepEqual(branchTokens('main'), ['main']);
  assert.deepEqual(branchTokens(null), []);
});

test('额度指标组：5h/本周独立成组，数值带百分号，低额度单独标记', () => {
  const groups = quotaGroups({
    primary: { label: '5h', remaining: 16 },
    secondary: { label: '周', remaining: 18 },
  });
  assert.deepEqual(groups, [
    { label: '5h', value: '16%', low: false },
    { label: '本周', value: '18%', low: false },
  ]);
  assert.equal(quotaGroups({ primary: { label: '5h', remaining: 8 } })[0].low, true);
  assert.deepEqual(quotaGroups({}), []);
  assert.deepEqual(quotaGroups({ primary: { label: '5h', remaining: null } }), []);
});

test('部分统计性质与估算标签合并可见', () => {
  assert.equal(feeLabel('ready'), '本会话估算');
  assert.equal(feeLabel('partial'), '本会话估算（部分）');
});

test('费用金额只给人民币主数字，区间保留，非法值不显示 0', () => {
  assert.equal(feeAmount({ cny: 0.62 }), '¥0.62');
  assert.equal(feeAmount({ cny: 0.62, rangeCny: [0.55, 0.7] }), '¥0.62–0.70');
  assert.equal(feeAmount({ cny: null }), null);
  assert.equal(feeAmount({ cny: 'bad' }), null);
  assert.equal(feeAmount({ cny: -1 }), null);
});

test('所有可见 footer 分支共用固定高度常量', () => {
  for (const kind of ['ready', 'loading', 'unknown', 'error', 'fee', 'quota']) {
    assert.equal(footerHeight(268, kind), FOOTER_H);
    assert.equal(footerHeight(240, kind), FOOTER_H);
  }
});

test('quota 状态决定底栏主行：费用只在无数据源时使用', () => {
  assert.equal(quotaLineKind('loading', null, true), 'loading');
  assert.equal(quotaLineKind('error', null, true), 'error');
  assert.equal(quotaLineKind('unknown', null, true), 'usage');
  assert.equal(quotaLineKind('unknown', null, true, '额度快照过旧'), 'stale');
  assert.equal(quotaLineKind('unknown', null, true, '该 Agent 暂无账户额度数据源'), 'usage');
  assert.equal(quotaLineKind('unknown', null, false), 'unknown');
  assert.equal(quotaLineKind('ready', 10 * 60 * 1000, true), 'quota');
  assert.equal(quotaLineKind('ready', null, true), 'stale');
  assert.equal(quotaLineKind('ready', 2 * 60 * 60 * 1000, true), 'stale');
});

test('费用三合一：s/1d/7d，10 元分界用两位/一位小数', () => {
  const s=feeSegments({session:{cny:2.04},today:{cny:12.3},week7:{cny:167.91}});
  assert.deepEqual(s.map(x=>x.label),['s','1d','7d']);
  assert.deepEqual(s.map(x=>x.value),['¥2.04','¥12.3','¥167.9']);
  assert.equal(feeSegments({session:{cny:9.99}})[0].value,'¥9.99');
  assert.equal(feeSegments({session:{cny:10}})[0].value,'¥10.0');
});

test('无数据与 0 显示占位，不出现 ¥0.00', () => {
  for (const b of [{cny:null},{cny:0},{},{cny:undefined}]) {
    const s=feeSegments({session:b,today:b,week7:b});
    assert.deepEqual(s.map(x=>x.value),[null,null,null]);
    assert.ok(s.every(x=>!String(x.value??'').includes('0.00')));
  }
});

test('tooltip 解释 s/1d/7d 并带上接口 reasons', () => {
  const tip=feeTooltip({status:'partial',session:{cny:2.81},today:{cny:2.81},week7:{cny:167.91},reasons:['claude(provider 未证实)']});
  assert.match(tip,/s[：:]/); assert.match(tip,/1d/); assert.match(tip,/7d/);
  assert.match(tip,/claude\(provider 未证实\)/);
  assert.match(tip,/API 等价估算/);
  const withBucket=feeTooltip({session:{cny:1.14},today:{cny:3.02,reason:'部分来源缺失：codex(部分)'},week7:{cny:168.1}});
  assert.match(withBucket,/1d：部分来源缺失：codex\(部分\)/);
});

test('footer 高度换成更大的固定常量，所有分支共用', () => {
  assert.ok(FOOTER_H>=90,'footer 常量需容纳换行');
  for(const k of ['loading','error','quota','usage','unknown','stale','idle']) assert.equal(footerHeight(240,k),FOOTER_H);
});

const NOW = 1_700_000_000_000;
const at = (sec) => ({ resetsAt: Math.floor(NOW / 1000) + sec });

test('重置行：5h 用小时、周用天，不足一天用小时，无数据返回 null', () => {
  assert.equal(resetHint({ primary: at(2 * 3600), secondary: at(5 * 86400) }, NOW), '重置 2h / 5d');
  assert.equal(resetHint({ primary: at(90 * 60) }, NOW), '重置 2h');
  assert.equal(resetHint({ secondary: at(20 * 3600) }, NOW), '重置 20h');
  assert.equal(resetHint({}, NOW), null);
  assert.equal(resetHint(null, NOW), null);
});

test('额度 tooltip 带精确重置时间、快照与三段费用 reasons', () => {
  const tip = quotaTooltip({ primary: at(2 * 3600), secondary: at(5 * 86400) }, {
    ageMs: 3 * 60000,
    refreshing: true,
    usageState: { session:{cny:2.04}, today:{cny:12.3}, week7:{cny:167.91}, reasons:['codex(部分)'] },
  });
  assert.match(tip, /5h 重置/);
  assert.match(tip, /周重置/);
  assert.match(tip, /快照 3 分钟前/);
  assert.match(tip, /刷新中/);
  assert.match(tip, /s:¥2\.04/);
  assert.match(tip, /7d:¥167\.9/);
  assert.match(tip, /codex\(部分\)/);
});

test('无费用数据时 tooltip 不出现 0 金额', () => {
  const tip = quotaTooltip({ primary: at(3600) }, { usageState: { session:{cny:null}, today:{cny:0}, week7:{} } });
  assert.match(tip, /s:–/);
  assert.doesNotMatch(tip, /¥0\.00/);
});

test('无感刷新：有旧值时 loading/error 都继续显示旧值', () => {
  const old = { status:'ready', primary:{ usedPercent:26 }, snapshotAt:NOW };
  const mem = { state:old, at:NOW };
  assert.equal(silentState({ status:'loading' }, mem), old);
  assert.equal(silentState({ status:'error', reason:'x' }, mem), old);
  assert.equal(silentState({ status:'ready', primary:{ usedPercent:30 } }, mem).primary.usedPercent, 30);
  assert.equal(hasValue(old), true);
  assert.equal(hasValue({ status:'unknown' }), false);
});

test('首次加载没有旧值时仍返回 loading，不会被吞掉', () => {
  assert.deepEqual(silentState({ status:'loading' }, null), { status:'loading' });
  assert.deepEqual(silentState({ status:'error', reason:'x' }, null), { status:'error', reason:'x' });
  assert.equal(silentState(null, null), null);
});
