// 待批 chip 的纯逻辑与异步生命周期：账本解析、计数口径、时长计算、目标安全、读取失败与关闭。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitRow, parseLedger, rowKey, countRows, ageText, classifyTarget, chipState, PendingStore, fixturePath, listPlan,
} from '../mods/workbench-tabs/pending.js';

const HEAD = '| 要你做什么 | 状态 | 不做会怎样 | 去哪点 | 提出时间 | 项目 |';
const SEP = '|---|---|---|---|---|---|';
const led = (...rows) => ['# 待你批准', '', HEAD, SEP, ...rows, ''].join('\n');
const T = '2026-11-14T10:00:00+08:00';
const NOW = Date.parse('2026-11-14T12:00:00+08:00');

test('空账本（只有表头）解析为 0 行，不是错误', () => {
  const p = parseLedger(led());
  assert.equal(p.error, null);
  assert.equal(p.rows.length, 0);
  assert.equal(countRows(p.rows), 0);
});

test('单行与多行解析，列按表头名对齐，未知列忽略', () => {
  const one = parseLedger(led(`| 合并 PR #4 | 待用户 | 规范停在分支 | https://github.com/x/y/pull/4 | ${T} | HerdrCLI |`));
  assert.equal(one.error, null);
  assert.equal(one.rows.length, 1);
  assert.equal(one.rows[0].what, '合并 PR #4');
  assert.equal(one.rows[0].impact, '规范停在分支');
  assert.equal(one.rows[0].where, 'https://github.com/x/y/pull/4');
  assert.equal(one.rows[0].proposedAt, T);
  assert.equal(one.rows[0].project, 'HerdrCLI');
  assert.equal(one.rows[0].done, false);

  const reordered = parseLedger(['| 项目 | 提出时间 | 要你做什么 | 状态 |', '|---|---|---|---|', `| A | ${T} | 做甲事 | 待用户 |`].join('\n'));
  assert.equal(reordered.error, null);
  assert.equal(reordered.rows[0].what, '做甲事');
  assert.equal(reordered.rows[0].project, 'A');

  const three = parseLedger(led(
    `| 甲 | 待用户 | 影响甲 | 去哪甲 | ${T} | P |`,
    `| 乙 | 待审批 | 影响乙 | 去哪乙 | ${T} | P |`,
    `| 丙 |  | 影响丙 | 去哪丙 | ${T} | P |`,
  ));
  assert.equal(countRows(three.rows), 3, '空状态与待用户/待审批都算未处理');
  assert.deepEqual(three.rows.map(r => r.what), ['甲', '乙', '丙']);
});

test('含「（示例）」的行跳过，其余照常计入', () => {
  const p = parseLedger(led(
    `| （示例）合并 PR | 待用户 | x | y | ${T} | P |`,
    `| 示例：批一次部署 | 待用户 | x | y | ${T} | P |`,
    `| 真事 | 待用户 | x | y | ${T} | P |`,
  ));
  assert.deepEqual(p.rows.map(r => r.what), ['示例：批一次部署', '真事']);
});

test('已读只影响视觉，不减少计数也不从列表移除', () => {
  const { rows } = parseLedger(led(`| 甲 | 待用户 | i | w | ${T} | P |`, `| 乙 | 待用户 | i | w | ${T} | P |`));
  const acks = { [rowKey(rows[0])]: 111 };
  assert.equal(countRows(rows), 2);
  assert.equal(countRows(rows, acks), 2);
  assert.equal(rows.length, 2);
});

test('账本状态改为已处理才清除（权威口径）', () => {
  const { rows } = parseLedger(led(
    `| 甲 | 待用户 | i | w | ${T} | P |`,
    `| 乙 | 已处理 | i | w | ${T} | P |`,
    `| 丙 | done | i | w | ${T} | P |`,
    `| 丁 | 已完成 | i | w | ${T} | P |`,
  ));
  assert.equal(rows.length, 4);
  assert.equal(countRows(rows), 1);
  assert.equal(rows.filter(r => !r.done).map(r => r.what).join(','), '甲');
});

test('时长由 UI 从 ISO 现算，缺列或坏值显示时间未知', () => {
  assert.equal(ageText({ proposedAt: T }, NOW), '2 小时');
  assert.equal(ageText({ proposedAt: '2026-11-14T11:59:30+08:00' }, NOW), '刚刚');
  assert.equal(ageText({ proposedAt: '2026-11-13T10:00:00+08:00' }, NOW), '1 天');
  assert.equal(ageText({ proposedAt: '2026-11-14T11:30:00+08:00' }, NOW), '30 分钟');
  assert.equal(ageText({ proposedAt: '' }, NOW), '时间未知');
  assert.equal(ageText({ proposedAt: 'not-a-time' }, NOW), '时间未知');
  assert.equal(ageText({}, NOW), '时间未知');
});

test('坏账本：无表头、缺必需列、坏行都不崩', () => {
  assert.equal(parseLedger('随便一段文字\n没有表格').error, 'no-header');
  assert.equal(parseLedger('| 项目 | 状态 |\n|---|---|').error, 'no-what');
  assert.equal(parseLedger('| 要你做什么 | 去哪点 |\n|---|---|\n| 甲 | w |').error, 'no-status', '状态列必填');
  const mixed = parseLedger(led(
    `| 甲 | 待用户 | i | w | ${T} | P |`,
    '|只有一列',
    `| 乙 | 待用户 | i | w | ${T} | P |`,
  ));
  assert.equal(mixed.error, null);
  assert.deepEqual(mixed.rows.map(r => r.what), ['甲', '乙']);
  assert.equal(parseLedger(null).error, 'unreadable');
});

test('单元格截断与行 key 稳定', () => {
  const long = 'x'.repeat(400);
  const { rows } = parseLedger(led(`| ${long} | 待用户 | i | w | ${T} | P |`));
  assert.ok(rows[0].what.length <= 201);
  assert.equal(rowKey({ what: '甲', where: 'w', proposedAt: T }), rowKey({ what: '甲', where: 'w', proposedAt: T }));
  assert.notEqual(rowKey({ what: '乙', where: 'w', proposedAt: T }), rowKey({ what: '甲', where: 'w', proposedAt: T }));
  assert.notEqual(
    rowKey({ what: '甲', where: 'w', proposedAt: T }),
    rowKey({ what: '甲', where: 'w', proposedAt: '2026-11-14T11:00:00+08:00' }),
  );
});

test('打开目标只放行 http/https 与 home 下绝对路径', () => {
  const home = '/Users/lanser';
  assert.deepEqual(classifyTarget('https://github.com/x/y/pull/4', home), { kind: 'url', value: 'https://github.com/x/y/pull/4' });
  assert.equal(classifyTarget('file:///etc/passwd', home), null);
  assert.equal(classifyTarget('javascript:alert(1)', home), null);
  assert.equal(classifyTarget('cursor://x', home), null);
  assert.equal(classifyTarget('ssh://host/x', home), null);
  assert.equal(classifyTarget('https://user:pw@example.com/x', home), null);
  assert.equal(classifyTarget('https://', home), null);
  assert.equal(classifyTarget('-a Calculator', home), null);
  assert.equal(classifyTarget('https://example.com/\u0007', home), null);
  assert.equal(classifyTarget('x'.repeat(501), home), null);
  assert.deepEqual(classifyTarget('~/ai/collab/pending.md', home), { kind: 'path', value: '/Users/lanser/ai/collab/pending.md' });
  assert.deepEqual(classifyTarget('/Users/lanser/Code/HerdrCLI/README.md', home), { kind: 'path', value: '/Users/lanser/Code/HerdrCLI/README.md' });
  assert.equal(classifyTarget('/etc/passwd', home), null, 'home 之外不放行');
  assert.equal(classifyTarget('/Users/lanser/../etc/passwd', home), null, '含 .. 不放行');
  assert.equal(classifyTarget('relative/path.md', home), null);
  assert.equal(classifyTarget('~/ai/collab/pending.md', ''), null, '无 home 时 ~ 不放行');
});

test('chip 三态：隐藏 / 计数 / 错误 / 缺失', () => {
  assert.deepEqual(chipState({ kind: 'hidden' }), { kind: 'hidden' });
  assert.deepEqual(chipState({ kind: 'count', count: 2 }), { kind: 'count', count: 2 });
  assert.equal(chipState({ kind: 'count', count: 0 }).kind, 'hidden');
  assert.equal(chipState({ kind: 'error', reason: 'no-header' }).kind, 'error');
  assert.equal(chipState({ kind: 'missing' }).kind, 'missing');
  assert.equal(chipState(undefined).kind, 'hidden');
});

test('账本缺失是错误态而不是静默隐藏，0 行才隐藏', async () => {
  const missing = new PendingStore({ read: async () => null });
  const state = await missing.refresh();
  assert.equal(state.kind, 'missing');
  assert.equal(chipState(state).kind, 'missing');

  const empty = new PendingStore({ read: async () => led() });
  assert.equal((await empty.refresh()).kind, 'hidden');
});

test('异步读取：异常报错、失败信息不外泄', async () => {
  const boom = new PendingStore({ read: async () => { throw new Error('/secret/path 读取失败'); } });
  const failed = await boom.refresh();
  assert.equal(failed.kind, 'error');
  assert.equal(failed.reason, 'read');

  const ok = new PendingStore({ read: async () => led(`| 甲 | 待用户 | i | w | ${T} | P |`) });
  const counted = await ok.refresh();
  assert.equal(counted.kind, 'count');
  assert.equal(counted.count, 1);
  assert.equal(ageText(counted.rows[0], NOW), '2 小时');
});

test('关闭后作废在途读取，不再改状态', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = new PendingStore({ read: () => gate });
  const inflight = store.refresh();
  store.close();
  release(led(`| 甲 | 待用户 | i | w | ${T} | P |`));
  const after = await inflight;
  assert.equal(after.kind, 'hidden');
  assert.equal(store.state.kind, 'hidden');
  assert.equal(store.closed, true);
});

test('fixture 覆盖只在有效期内且指向临时目录时生效', () => {
  const now = 1_700_000_000_000;
  const ok = JSON.stringify({ path: '/tmp/herdr-approvals-fixture.md', until: now + 60_000 });
  assert.equal(fixturePath(ok, now), '/tmp/herdr-approvals-fixture.md');
  assert.equal(fixturePath(ok, now + 60_001), null, '过期不生效');
  assert.equal(fixturePath(JSON.stringify({ path: '/Users/lanser/ai/collab/pending.md', until: now + 60_000 }), now), null, '非临时目录不生效');
  assert.equal(fixturePath('not json', now), null);
  assert.equal(fixturePath(null, now), null);
});

test('解析失败后恢复为计数，状态可回落', async () => {
  let text = '不是表格';
  const store = new PendingStore({ read: async () => text });
  assert.equal((await store.refresh()).kind, 'error');
  text = led(`| 甲 | 待用户 | i | w | ${T} | P |`);
  assert.equal((await store.refresh()).kind, 'count');
  text = led();
  assert.equal((await store.refresh()).kind, 'hidden');
});


const rowAt = i => ({ what: `第${i}条`, where: '', proposedAt: T, done: false });
const rowsN = n => Array.from({ length: n }, (_, i) => rowAt(i + 1));

test('分页：0/1 行都在单页，不出现翻页', () => {
  for (const n of [0, 1]) {
    const p = listPlan(rowsN(n), 0, 6);
    assert.equal(p.pages, 1);
    assert.equal(p.page, 0);
    assert.equal(p.shown.length, n);
    assert.equal(p.more, 0);
  }
});

test('分页：7 行时分两页，跨页顺序与末页条数正确', () => {
  const rows = rowsN(7);
  const first = listPlan(rows, 0, 6);
  assert.equal(first.pages, 2);
  assert.equal(first.shown.length, 6);
  assert.equal(first.more, 1);
  const second = listPlan(rows, 1, 6);
  assert.equal(second.shown.length, 1);
  assert.equal(second.shown[0].what, '第7条');
  assert.equal(second.more, 0);
  // 顺序不因翻页改变
  assert.deepEqual(listPlan(rows, 1, 6).shown[0], rows[6]);
});

test('分页：200 行 34 页，末页 2 条', () => {
  const rows = rowsN(200);
  const last = listPlan(rows, 33, 6);
  assert.equal(last.pages, 34);
  assert.equal(last.shown.length, 2);
  assert.equal(last.shown[0].what, '第199条');
  assert.equal(last.shown[1].what, '第200条');
  assert.equal(listPlan(rows, 0, 6).shown[0].what, '第1条');
});

test('分页：页码越界与行数骤减都夹取，不停在空页', () => {
  const rows = rowsN(200);
  assert.equal(listPlan(rows, 99, 6).page, 33);
  assert.equal(listPlan(rows, -3, 6).page, 0);
  const shrunk = rowsN(7);
  const p = listPlan(shrunk, 33, 6);
  assert.equal(p.page, 1);
  assert.equal(p.shown.length, 1);
});

test('分页：任何页的计数都不变，已读也不改变条数', () => {
  const rows = rowsN(200);
  const acks = { [rowKey(rows[0])]: 1 };
  for (const page of [0, 1, 33]) {
    const plan = listPlan(rows, page, 6);
    assert.equal(countRows(rows), 200);
    assert.equal(countRows(rows, acks), 200);
    assert.equal(plan.pages, 34);
  }
});

test('分页：已完成行不进入列表，页数按未处理行算', () => {
  const rows = [...rowsN(6), { ...rowAt(7), done: true }];
  const pending = rows.filter(r => !r.done);
  const plan = listPlan(pending, 0, 6);
  assert.equal(plan.shown.length, 6);
  assert.equal(plan.pages, 1);
  assert.equal(plan.more, 0);
});
