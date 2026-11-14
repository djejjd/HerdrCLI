// 待批 chip 的纯逻辑与异步生命周期：账本解析、计数口径、时长计算、目标安全、读取失败与关闭。
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitRow, parseLedger, rowKey, countRows, ageText, classifyTarget, chipState, PendingStore, fixturePath, listPlan,
  nextEmptyStreak, closePlan, navPlan, ledgerSignature, pickState, closeFocusPlan, creationHint, rowsForSpace, pickApprovalsPane,
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
  assert.equal(chipState({ kind: 'empty' }).kind, 'hidden');
  assert.equal(chipState({ kind: 'error', reason: 'no-header' }).kind, 'error');
  assert.equal(chipState({ kind: 'missing' }).kind, 'missing');
  assert.equal(chipState(undefined).kind, 'hidden');
});

test('账本缺失是缺失态而不是静默隐藏，0 行是空态（chip 隐藏）', async () => {
  const missing = new PendingStore({ read: async () => null });
  const state = await missing.refresh();
  assert.equal(state.kind, 'missing');
  assert.equal(chipState(state).kind, 'missing');

  const empty = new PendingStore({ read: async () => led() });
  const emptyState = await empty.refresh();
  assert.equal(emptyState.kind, 'empty');
  assert.equal(chipState(emptyState).kind, 'hidden');
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
  assert.equal((await store.refresh()).kind, 'empty');
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


test('空态计数：连续两次成功读到 EMPTY 才累积，其它状态清零', () => {
  assert.equal(nextEmptyStreak(0, 'empty'), 1);
  assert.equal(nextEmptyStreak(1, 'empty'), 2);
  assert.equal(nextEmptyStreak(2, 'empty'), 3);
  assert.equal(nextEmptyStreak(1, 'count'), 0);
  assert.equal(nextEmptyStreak(2, 'missing'), 0, '读取失败/缺失不算空态');
  assert.equal(nextEmptyStreak(2, 'error'), 0);
  assert.equal(nextEmptyStreak(0, 'count'), 0);
});

test('自动关闭判定：只有非当前、标签数>1、连续两次空态才关', () => {
  const base = { kind: 'empty', active: false, tabCount: 2, emptyStreak: 2 };
  assert.equal(closePlan(base), 'close');
  assert.equal(closePlan({ ...base, emptyStreak: 1 }), 'keep', '第一次空态不动');
  assert.equal(closePlan({ ...base, active: true }), 'banner', '当前标签只提示');
  assert.equal(closePlan({ ...base, tabCount: 1 }), 'banner', '仅剩一个标签不关');
  assert.equal(closePlan({ ...base, kind: 'count' }), 'keep');
  assert.equal(closePlan({ ...base, kind: 'missing' }), 'keep', '缺失不算空');
  assert.equal(closePlan({ ...base, kind: 'error' }), 'keep', '解析失败不算空');
});

test('导航：tracked 存活优先复用，否则按 panes 兜底，随后才是新建', () => {
  const tabs = [{ id: 'tb1' }, { id: 'tb2' }];
  const panes = [{ pane: 'p1', tab: 'tb1', mod: 'workbench-tabs' }];
  assert.deepEqual(navPlan({ panes, tabs, tracked: 'tb1', now: 1000 }), { kind: 'open', tab: 'tb1', pane: 'p1' });
  // tracked 已不在 tabs 里，panes 里也没有 -> 新建
  assert.deepEqual(navPlan({ panes: [], tabs, tracked: 'tb9', opening: 0, now: 1000 }), { kind: 'create' });
  // tracked 失效但 panes 仍能兜底
  assert.deepEqual(navPlan({ panes, tabs, tracked: 'tb9', now: 1000 }), { kind: 'open', tab: 'tb1', pane: 'p1' });
});

test('导航：在途锁 5 秒内重复点击只等待，不重复新建', () => {
  const args = { panes: [], tabs: [{ id: 'tb1' }], tracked: null, opening: 10_000 };
  assert.equal(navPlan({ ...args, now: 10_500 }).kind, 'wait', '500ms 内重复点');
  assert.equal(navPlan({ ...args, now: 14_900 }).kind, 'wait', '4.9s 仍是等待');
  assert.equal(navPlan({ ...args, now: 15_100 }).kind, 'create', '5s 后允许重试');
});

test('连续三次开→关→再开：每个周期只允许一次新建', () => {
  // 模拟真实时序：tab.new 之后 panes/tracked 还没更新（下一帧才有），
  // 此时连点必须只等待，不能再发一次 tab.new。
  let panes = [];
  let tabs = [{ id: 'main' }];
  let tracked = null;
  let opening = 0;
  let creates = 0;
  const click = (now) => {
    const plan = navPlan({ panes, tabs, tracked, opening, now });
    if (plan.kind === 'create') {
      creates += 1;
      opening = now;
      tabs = [...tabs, { id: `tb${creates}` }];
    }
    return plan.kind;
  };
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const base = cycle * 10_000;
    assert.equal(click(base), 'create', `第 ${cycle} 次开：新建`);
    assert.equal(click(base + 200), 'wait', `第 ${cycle} 次：新 pane 还没出现时连点只等待`);
    assert.equal(click(base + 900), 'wait', `第 ${cycle} 次：锁内仍等待`);
    assert.equal(creates, cycle, `第 ${cycle} 次开只新建一次`);
    // 下一帧 pane 出现，tracked 记住它
    tracked = `tb${creates}`;
    panes = [{ pane: `p${creates}`, tab: tracked, mod: 'workbench-tabs' }];
    assert.equal(click(base + 1000), 'open', 'pane 出现后点击是复用');
    // 关掉这个标签：下一次点击属于下一周期，应能重建
    panes = [];
    tabs = tabs.filter(t => t.id !== tracked);
    tracked = null;
  }
  assert.equal(creates, 3, '三个周期共三次新建，没有重复');
  assert.equal(navPlan({ panes: [], tabs: [{ id: 'main' }], tracked: null, now: 99_000 }).kind, 'create', '全部关掉后仍可重建');
});
test('手动关闭后仍有 COUNT：chip 可见，再点走重建', () => {
  assert.equal(chipState({ kind: 'count', count: 3 }).kind, 'count');
  assert.equal(navPlan({ panes: [], tabs: [{ id: 'tb1' }], tracked: null, now: 5000 }).kind, 'create');
  assert.equal(navPlan({ panes: [{ pane: 'p1', tab: 'tb1', mod: 'workbench-tabs' }], tabs: [{ id: 'tb1' }], tracked: null, now: 5000 }).kind, 'open');
});


test('发布签名：条数相同但内容变化也必须变', () => {
  const base = { kind: 'count', count: 2, rows: [
    { what: '甲', where: 'w1', proposedAt: T, project: 'P', done: false },
    { what: '乙', where: 'w2', proposedAt: T, project: 'P', done: false },
  ] };
  const replaced = { kind: 'count', count: 2, rows: [
    { what: '甲', where: 'w1', proposedAt: T, project: 'P', done: false },
    { what: '丙', where: 'w2', proposedAt: T, project: 'P', done: false },
  ] };
  const edited = { kind: 'count', count: 2, rows: [
    { what: '甲改', where: 'w1', proposedAt: T, project: 'P', done: false },
    { what: '乙', where: 'w2', proposedAt: T, project: 'P', done: false },
  ] };
  const same = { kind: 'count', count: 2, rows: base.rows.map(r => ({ ...r })) };
  assert.equal(ledgerSignature(base), ledgerSignature(same), '内容相同签名相同');
  assert.notEqual(ledgerSignature(base), ledgerSignature(replaced), '同条数换行要变');
  assert.notEqual(ledgerSignature(base), ledgerSignature(edited), '同条数改标题要变');
  const impactOnly = { kind: 'count', count: 2, rows: [
    { ...base.rows[0], impact: '换了说明' },
    base.rows[1],
  ] };
  assert.notEqual(ledgerSignature(base), ledgerSignature(impactOnly), '同条数只改 impact 也要变');
  // 状态改动（done）也要变
  const toggled = { ...base, rows: [ { ...base.rows[0], done: true }, base.rows[1] ] };
  assert.notEqual(ledgerSignature(base), ledgerSignature(toggled));
  // 空/缺失/错误各自可区分
  assert.notEqual(ledgerSignature({ kind: 'empty', rows: [] }), ledgerSignature({ kind: 'missing', rows: [] }));
});

test('shared 与本地读取的先后：谁的时间新用谁', () => {
  const shared = { kind: 'count', count: 1, rows: [{ what: '旧' }], at: 100 };
  const own = { kind: 'count', count: 1, rows: [{ what: '新' }], at: 200 };
  assert.equal(pickState(shared, own).rows[0].what, '新', '本地更新时用本地');
  assert.equal(pickState(shared, { ...own, at: 50 }).rows[0].what, '旧', 'shared 更新时用 shared');
  assert.equal(pickState(shared, null).rows[0].what, '旧');
  assert.equal(pickState(null, own).rows[0].what, '新');
  assert.equal(pickState(null, null), null);
  assert.equal(pickState(shared, { kind: 'hidden' }).rows[0].what, '旧', 'hidden 的本地状态不算新鲜');
});


test('状态带括注仍算已处理（真实账本写法）', () => {
  const { rows } = parseLedger(led(
    `| 甲 | 已处理（选 A，已可打开） | i | w | ${T} | P |`,
    `| 乙 | 已处理（有下划线） | i | w | ${T} | P |`,
    `| 丙 | 已完成 ✅ | i | w | ${T} | P |`,
    `| 丁 | done（已合） | i | w | ${T} | P |`,
    `| 戊 | 待用户 | i | w | ${T} | P |`,
    `| 己 | 待处理 | i | w | ${T} | P |`,
  ));
  assert.equal(countRows(rows), 2, '只有戊与己算未处理');
  assert.deepEqual(rows.filter(r => !r.done).map(r => r.what), ['戊', '己']);
});

test('真实账本样例：1 条未处理 + 带括注的已处理 + 示例行', () => {
  const text = [
    '| 要你做什么 | 状态 | 不做会怎样 | 去哪点 | 提出时间 | 项目 |',
    '|---|---|---|---|---|---|',
    `| 决定是否合并 PR #7 | 待用户 | chip 停在分支 | https://github.com/x/y/pull/7 | ${T} | HerdrCLI |`,
    `| 跑一条 open 命令 | 已处理（选 A，已可打开） | 无法定位 | t16 | ${T} | HerdrCLI |`,
    `| 批准回滚 | 已处理 | 界面显示假数据 | t19 | ${T} | HerdrCLI |`,
    `| （示例）合并 PR #2 | 待用户 | 规则停在分支 | <链接> | ${T} | ai |`,
  ].join('\n');
  const { rows, error } = parseLedger(text);
  assert.equal(error, null);
  assert.equal(rows.length, 3, '示例行被跳过');
  assert.equal(countRows(rows), 1);
  assert.equal(rows.find(r => !r.done).what, '决定是否合并 PR #7');
});


test('关闭后的焦点恢复：回到上一个会话，原窗已关则退到首个可用', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  // 待批标签还在：不切换
  assert.equal(closeFocusPlan({ closing: 'b', prev: 'a', tabs }), null);
  // 待批已关、上一个还在：回 a
  assert.equal(closeFocusPlan({ closing: 'b', prev: 'a', tabs: [{ id: 'a' }, { id: 'c' }] }), 'a');
  // 上一个也没了：退到同空间首个不是 closing 的
  assert.equal(closeFocusPlan({ closing: 'b', prev: 'z', tabs: [{ id: 'a' }, { id: 'c' }] }), 'a');
  // 只剩 closing 一个：没有可恢复目标
  assert.equal(closeFocusPlan({ closing: 'b', prev: null, tabs: [] }), null);
});

test('跨 space 隔离：别的 space 的同名面板不算待批标签', () => {
  const here = [{ id: 'h1' }, { id: 'h2' }];
  const panes = [
    { pane: 'p9', tab: 'x9', mod: 'workbench-tabs' },
    { pane: 'p1', tab: 'h1', mod: 'workbench-tabs' },
  ];
  // 只认当前 space 的 tab 列表，别的 space 的同 mod 面板不参与
  assert.deepEqual(navPlan({ panes, tabs: here, tracked: null, now: 1000 }), { kind: 'open', tab: 'h1', pane: 'p1' });
  assert.deepEqual(navPlan({ panes: [panes[0]], tabs: here, tracked: null, now: 1000 }), { kind: 'create' });
});

test('在途锁与失败窗口统一 5 秒', () => {
  const args = { panes: [], tabs: [{ id: 'a' }], tracked: null, opening: 10_000 };
  assert.equal(navPlan({ ...args, now: 12_000 }).kind, 'wait');
  assert.equal(navPlan({ ...args, now: 15_100 }).kind, 'create');
  // pane 延迟 3 秒时才出现：两次点击也只建一次
  let creates = 0;
  const tabs = [{ id: 'a' }];
  const click = (now) => {
    const plan = navPlan({ panes: [], tabs, tracked: null, opening: creates ? 10_000 : 0, now, cooldown: 5000 });
    if (plan.kind === 'create') creates += 1;
    return plan.kind;
  };
  assert.equal(click(10_000), 'create');
  assert.equal(click(13_000), 'wait');
  assert.equal(creates, 1);
});

test('表头扫描：跳过前置表，直到含「要你做什么」的那张表', () => {
  const text = [
    '| 项目 | 负责人 |',
    '|---|---|',
    '| HerdrCLI | t16 |',
    '',
    '| 要你做什么 | 状态 | 不做会怎样 | 去哪点 | 提出时间 | 项目 |',
    '|---|---|---|---|---|---|',
    `| 甲 | 待用户 | i | w | ${T} | P |`,
  ].join('\n');
  const p = parseLedger(text);
  assert.equal(p.error, null);
  assert.deepEqual(p.rows.map(r => r.what), ['甲']);

  const unrelated = parseLedger('| 项目 | 负责人 |\n|---|---|\n| A | B |');
  assert.equal(unrelated.error, 'no-what', '有表但没有必需列');
  assert.equal(parseLedger('纯文字没有表格').error, 'no-header');
});

test('创建提示：出现即清除，失败立刻提示，5 秒没出现算超时', () => {
  assert.equal(creationHint({ appearing: true, opening: 10_000, now: 10_100 }), null);
  assert.equal(creationHint({ appearing: false, failed: true, opening: 10_000, now: 10_100 }), 'failed');
  assert.equal(creationHint({ appearing: false, opening: 10_000, now: 14_900 }), null);
  assert.equal(creationHint({ appearing: false, opening: 10_000, now: 15_100 }), 'timeout');
});


test('Space 列：解析到每条上；缺列时全部按全局', () => {
  const withSpace = parseLedger([
    '| 要你做什么 | Space | 状态 | 不做会怎样 | 去哪点 | 提出时间 | 项目 |',
    '|---|---|---|---|---|---|---|',
    `| 甲 | HerdrCLI | 待用户 | i | w | ${T} | P |`,
    `| 乙 |  | 待用户 | i | w | ${T} | P |`,
  ].join('\n'));
  assert.equal(withSpace.error, null);
  assert.deepEqual(withSpace.rows.map(r => r.space), ['HerdrCLI', '']);

  const noSpace = parseLedger(led(`| 甲 | 待用户 | i | w | ${T} | P |`));
  assert.equal(noSpace.error, null);
  assert.equal(noSpace.rows[0].space, '', '缺 Space 列 = 全局');
});

test('rowsForSpace：全局都显示，本 Space 只显示自己的，别的现存 Space 不显示', () => {
  const rows = [
    { what: '全局', space: '' },
    { what: 'A 的', space: 'AIAgentCLI' },
    { what: 'B 的', space: 'AIBot' },
    { what: '按 id', space: 'sp123' },
  ];
  const known = [{ id: 'sp999', name: 'AIAgentCLI' }, { id: 'sp123', name: 'AIBot' }, { id: 'spX', name: 'AICourse' }];
  const a = rowsForSpace(rows, { id: 'sp999', name: 'AIAgentCLI' }, known);
  assert.deepEqual(a.map(r => r.what), ['全局', 'A 的']);
  const b = rowsForSpace(rows, { id: 'sp123', name: 'AIBot' }, known);
  assert.deepEqual(b.map(r => r.what), ['全局', 'B 的', '按 id']);
  // 新建的空 Space：没有自己的行，只剩全局
  assert.deepEqual(rowsForSpace(rows, { id: 'spNew', name: 'testBot' }, known).map(r => r.what), ['全局']);
  assert.deepEqual(rowsForSpace([], { name: 'A' }, known), []);
  assert.deepEqual(rowsForSpace(null, { name: 'A' }, known), []);
});

test('rowsForSpace：Space 改名/删除导致匹配不到时按全局处理，不静默隐藏', () => {
  // 账本里写着旧名 OldName，但现在只剩 Renamed（改名）或已删除
  const rows = [{ what: '旧 Space 的', space: 'OldName' }];
  const known = [{ id: 'sp1', name: 'Renamed' }];
  assert.deepEqual(rowsForSpace(rows, { id: 'sp1', name: 'Renamed' }, known).map(r => r.what), ['旧 Space 的']);
  // 账本里写的是未知名字，任何 Space 都应看到（安全侧）
  assert.deepEqual(rowsForSpace([{ what: 'x', space: 'ghost' }], { name: 'testBot' }, known).map(r => r.what), ['x']);
  // 明确属于另一个现存 Space 的仍然隐藏
  assert.deepEqual(rowsForSpace([{ what: 'y', space: 'Renamed' }], { id: 'sp2', name: 'testBot' }, known), []);
});

test('新 Space 零配置：只有全局行就显示全局，没有全局就是 0', () => {
  const known = [{ id: 'sp1', name: 'AIAgentCLI' }];
  const globalRows = [{ what: '全局', space: '' }, { what: '别人的', space: 'AIAgentCLI' }];
  const fresh = { id: 'spNew', name: 'testBot' };
  assert.equal(countRows(rowsForSpace(globalRows, fresh, known)), 1, '新 Space 看到全局');
  assert.equal(countRows(rowsForSpace([{ what: '别人的', space: 'AIAgentCLI' }], fresh, known)), 0, '无全局则不显示');
});

test('本 Space 计数为 0 时 chip 隐藏（全局为 0 也一样）', () => {
  const rows = [{ what: '别的 space', space: 'AIBot' }];
  const known = [{ id: 'sp2', name: 'AIBot' }];
  const mine = rowsForSpace(rows, { name: 'AIAgentCLI' }, known);
  assert.equal(countRows(mine), 0);
  assert.equal(chipState({ kind: 'count', count: countRows(mine) }).kind, 'hidden');
});


test('静态检查：main.js 用到的 pending 导出必须都在 import 里', () => {
  const main = readFileSync(new URL('../mods/workbench-tabs/main.js', import.meta.url), 'utf8');
  const pend = readFileSync(new URL('../mods/workbench-tabs/pending.js', import.meta.url), 'utf8');
  const line = main.match(/import \{([^}]+)\} from '\.\/pending\.js'/);
  assert.ok(line, 'main.js 应有 pending.js 的 import');
  const imported = line[1].split(',').map(s => s.trim()).filter(Boolean);
  const exported = [...pend.matchAll(/export (?:function|class|const) (\w+)/g)].map(m => m[1]);
  const used = exported.filter(name => new RegExp(`\\b${name}\\b`).test(main));
  const missing = used.filter(name => !imported.includes(name));
  assert.deepEqual(missing, [], `有导出被引用但没 import：${missing.join(', ')}`);
});

test('外部关闭（Cmd+W）后状态清理，再开不复用陈旧标签', () => {
  const tabsOpen = [{ id: 'main' }, { id: 'tb2' }];
  const panes = [{ pane: 'p2', tab: 'tb2', mod: 'workbench-tabs' }];
  let tracked = 'tb2';
  let restoreTo = 'main';
  assert.equal(navPlan({ panes, tabs: tabsOpen, tracked, opening: 0, now: 1000 }).kind, 'open');
  // 外部关闭：模型里标签与面板都没了，本地 tracked 还没来得及清
  const tabsAfter = [{ id: 'main' }];
  assert.equal(closeFocusPlan({ closing: tracked, prev: restoreTo, tabs: tabsAfter }), 'main', '焦点回到原会话');
  tracked = null; restoreTo = null;
  // 再点：不得拿陈旧 tracked 去 open
  assert.equal(navPlan({ panes: [], tabs: tabsAfter, tracked, opening: 0, now: 2000 }).kind, 'create');
});


test('关闭判定按 Space 隔离：A 实例不得碰 B 的标签，B 只关自己的', () => {
  const panes = [
    { pane: 'pA', tab: 'tbA', mod: 'workbench-tabs' },
    { pane: 'pB', tab: 'tbB', mod: 'workbench-tabs' },
  ];
  const tabsA = [{ id: 'tbA' }, { id: 'tbMainA' }];
  const tabsB = [{ id: 'tbB' }, { id: 'tbMainB' }];
  assert.equal(pickApprovalsPane(panes, tabsA).pane, 'pA');
  assert.equal(pickApprovalsPane(panes, tabsB).pane, 'pB');
  // 当前 Space 的 tabs 里没有 B 的标签时，B 的面板不参与
  assert.equal(pickApprovalsPane([panes[1]], tabsA), null);
  // B 在 0 条且非当前、标签数>1 时关闭自己
  assert.equal(closePlan({ kind: 'empty', active: false, tabCount: tabsB.length, emptyStreak: 2 }), 'close');
  // 两 Space 各自有标签时互不影响：A 的判定只看 A 的 tabs
  assert.equal(closePlan({ kind: 'count', active: false, tabCount: tabsA.length, emptyStreak: 0 }), 'keep');
});


test('静态检查：main.js 不得把 null 传给 child/slot（渲染期空子元素会抛错）', () => {
  const main = readFileSync(new URL('../mods/workbench-tabs/main.js', import.meta.url), 'utf8');
  assert.equal(/\.child\(\s*null\s*\)/.test(main), false, '不要 .child(null)');
  assert.equal(/\.children\(\s*null\s*\)/.test(main), false, '不要 .children(null)');
  assert.equal(/slot\(\s*null\s*\)/.test(main), false, '空槽位用 emptySlot()，不要 slot(null)');
});

test('三种 Space 分支：未知按全局、别的现存 Space 隐藏、空 Space 只看全局', () => {
  const known = [{ id: 'sp1', name: 'AIAgentCLI' }];
  const rows = [{ what: '全局行', space: '' }, { what: 'A 的行', space: 'AIAgentCLI' }];
  // 账本里的 Space 匹配不到现存 Space（改名/删除）→ 按全局，任何 Space 都看得到
  const ghost = { what: '旧名行', space: 'OldName' };
  assert.equal(countRows(rowsForSpace([...rows, ghost], { name: 'testBot' }, known)), 2);
  // 明确属于别的现存 Space（AIAgentCLI）→ 只剩全局
  assert.equal(countRows(rowsForSpace(rows, { name: 'testBot' }, known)), 1);
  // 空 Space（无终端、无名字）→ 只剩全局；没有全局就是 0
  assert.equal(countRows(rowsForSpace(rows, { id: 'spNew', name: '' }, known)), 1);
  assert.equal(countRows(rowsForSpace([{ what: 'A 的行', space: 'AIAgentCLI' }], { id: 'spNew', name: '' }, known)), 0);
});
