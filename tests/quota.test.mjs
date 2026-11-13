// 额度解析与异步竞态：先测真实控制逻辑，不在测试里复写计数器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { remaining, windowLabel, parseCodexQuota, QuotaController, pickQuotaTarget, quotaKey, sessionHome, matchAccount, pickFresh } from '../mods/agent-workbench/quota.js';
const tick = () => new Promise(r => setImmediate(r));

test('额度只从合法 used_percent 计算剩余', () => {
  assert.equal(remaining(26), 74);
  assert.equal(remaining(0), 100);
  assert.equal(remaining(100), 0);
  assert.equal(remaining(-1), null);
  assert.equal(remaining(101), null);
  assert.equal(remaining('26'), null);
  assert.equal(remaining(undefined), null);
  assert.equal(windowLabel(300), '5h');
  assert.equal(windowLabel(1440), '1天');
  assert.equal(windowLabel(2880), '2天');
  assert.equal(windowLabel(10080), '周');
  assert.equal(windowLabel(20160), '2周');
  assert.equal(windowLabel(0), null);
});

test('Codex 快照缺字段或越界返回 unknown', () => {
  const ok = parseCodexQuota({primary:{used_percent:26,window_minutes:300,resets_at:1794593151},secondary:{used_percent:73,window_minutes:10080,resets_at:1795008603},plan_type:'plus'}, 123);
  assert.equal(ok.status, 'ready');
  assert.deepEqual([ok.primary.label, ok.primary.remaining], ['5h', 74]);
  assert.deepEqual([ok.secondary.label, ok.secondary.remaining], ['周', 27]);
  assert.equal(ok.plan, 'plus');
  assert.equal(ok.snapshotAt, 123);
  assert.equal(parseCodexQuota({primary:{used_percent:120,window_minutes:300}}).status, 'unknown');
  assert.equal(parseCodexQuota({primary:{used_percent:10}}).status, 'unknown');
  assert.equal(parseCodexQuota(null).status, 'unknown');
});

test('身份不足时不发请求，直接 unknown', () => {
  let calls = 0;
  const c = new QuotaController({ load: () => { calls++; return {status:'ready'}; } });
  c.setTarget({ program:'codex', id:null });
  assert.equal(calls, 0);
  assert.equal(c.state.status, 'unknown');
});

test('切换身份后旧请求晚到不覆盖新状态', async () => {
  const pending = [];
  const c = new QuotaController({ load: (id) => new Promise(res => pending.push({ id, res })) });
  c.setTarget({ program:'codex', id:'a' });
  assert.equal(c.state.status, 'loading');
  c.setTarget({ program:'codex', id:'b' });
  pending[0].res({ status:'ready', primary:{ label:'5h', remaining:10 } });
  await tick();
  assert.equal(c.state.status, 'loading');
  pending[1].res({ status:'ready', primary:{ label:'5h', remaining:80 } });
  await tick();
  assert.equal(c.state.primary.remaining, 80);
});

test('切到 shell/Files 清空并忽略未完成请求', async () => {
  let resolve;
  const c = new QuotaController({ load: () => new Promise(r => { resolve = r; }) });
  c.setTarget({ program:'codex', id:'a' });
  c.setTarget(null);
  resolve({ status:'ready', primary:{ label:'5h', remaining:90 } });
  await tick();
  assert.equal(c.state.status, 'idle');
});

test('关闭/卸载取消后不再写状态；失败进入 error', async () => {
  let reject;
  const c = new QuotaController({ load: () => new Promise((_r, rj) => { reject = rj; }) });
  c.setTarget({ program:'codex', id:'a' });
  c.close();
  reject(new Error('boom'));
  await tick();
  assert.equal(c.state.status, 'idle');

  const c2 = new QuotaController({ load: () => Promise.reject(new Error('bad json')) });
  c2.setTarget({ program:'codex', id:'b' });
  await tick();
  assert.equal(c2.state.status, 'error');
  assert.match(c2.state.reason, /bad json/);
});

test('同一身份命中缓存不重复读取', async () => {
  let calls = 0;
  const c = new QuotaController({ load: async () => { calls++; return { status:'ready', primary:{ label:'5h', remaining:50 } }; }, now: () => 1000 });
  c.setTarget({ program:'codex', id:'a' });
  await tick();
  c.setTarget({ program:'claude', id:'x' });
  await tick();
  const callsBefore = calls;
  c.setTarget({ program:'codex', id:'a' });
  await tick();
  assert.equal(calls, callsBefore);
  assert.equal(c.state.primary.remaining, 50);
});

test('额度目标必须是 focused 的 live 终端且该终端就是 Agent', () => {
  const agents=[{address:'t2',program:{key:'codex'}}];
  const terminals=[{address:'t2',state:'live',foreground:{pid:46181},labels:{}}];
  assert.equal(pickQuotaTarget(null,terminals,agents), null);
  // Files pane 可能只剩下一半焦点：terminal 为 null。
  assert.equal(pickQuotaTarget({agent:'t2',terminal:null},terminals,agents), null);
  assert.equal(pickQuotaTarget({agent:'t2',terminal:'t2'},[{address:'t2',state:'finished',labels:{}}],agents), null);
  assert.equal(pickQuotaTarget({agent:'t9',terminal:'t9'},[{address:'t9',state:'live',labels:{}}],[{address:'t9',program:{key:'zsh'}}]), null);
  const ok=pickQuotaTarget({agent:'t2',terminal:'t2'},terminals,agents);
  assert.equal(ok.program,'codex');
  assert.equal(ok.id,'46181');
});

test('focused pane 是 Files 等 mod pane 时额度目标为空', () => {
  const agents=[{address:'t2',program:{key:'codex'}}];
  const terminals=[{address:'t2',state:'live',foreground:{pid:46181},labels:{}}];
  const modPanes=[{pane:'p1',terminal:null,mod:'files'}];
  assert.equal(pickQuotaTarget({pane:'p1',agent:'t2',terminal:'t2'},terminals,agents,modPanes), null);
  const termPanes=[{pane:'p1',terminal:'t2'}];
  assert.ok(pickQuotaTarget({pane:'p1',agent:'t2',terminal:'t2'},terminals,agents,termPanes));
  // 布局终端块聚焦时 pane 为 null，仍按 terminal 判定。
  assert.ok(pickQuotaTarget({pane:null,agent:'t2',terminal:'t2'},terminals,agents,[]));
});

test('同一身份的 TTL：缓存新鲜不重读，过期后重读，失败可重试', async () => {
  let clock=1000,calls=0;
  const c=new QuotaController({ now:()=>clock, ttlMs:30000, load:async () => { calls++; return { status:'ready', primary:{ label:'5h', remaining:50 } }; } });
  const id={ program:'codex', id:'a' };
  assert.equal(c.setTarget(id), true);
  await tick();
  assert.equal(calls, 1);
  // 同一身份、缓存新鲜：不重读也不重复通知。
  assert.equal(c.setTarget(id), false);
  await tick();
  assert.equal(calls, 1);
  // 过期后同一身份允许重读。
  clock+=31000;
  assert.equal(c.setTarget(id), true);
  await tick();
  assert.equal(calls, 2);

  let fails=0;
  const c2=new QuotaController({ now:()=>clock, ttlMs:1000, load:async () => { fails++; if(fails===1) throw new Error('第一次失败'); return { status:'ready', primary:{ label:'5h', remaining:70 } }; } });
  c2.setTarget({ program:'codex', id:'b' });
  await tick();
  assert.equal(c2.state.status, 'error');
  clock+=1001;
  c2.setTarget({ program:'codex', id:'b' });
  await tick();
  assert.equal(c2.state.status, 'ready');
  assert.equal(c2.state.primary.remaining, 70);
});

test('A 加载中切到 B 再切回 A 不恢复 loading，会重新发起', async () => {
  const pending = [];
  let calls = 0;
  const c = new QuotaController({ load: (id) => { calls++; return new Promise(res => pending.push({ id, res })); } });
  c.setTarget({ program:'codex', id:'a' });
  assert.equal(c.state.status, 'loading');
  c.setTarget({ program:'codex', id:'b' });
  assert.equal(calls, 2);
  // 切回 A：旧 gen 的 loading 不能被复用，必须重新发请求。
  c.setTarget({ program:'codex', id:'a' });
  assert.equal(calls, 3);
  assert.equal(c.state.status, 'loading');
  // 旧 A 请求晚到也不能覆盖。
  pending[0].res({ status:'ready', primary:{ label:'5h', remaining:10 } });
  await tick();
  assert.equal(c.state.status, 'loading');
  pending[2].res({ status:'ready', primary:{ label:'5h', remaining:88 } });
  await tick();
  assert.equal(c.state.primary.remaining, 88);
});

test('同 key 刷新保留旧数字并标刷新中，切 target 清空', async () => {
  let clock=1000, mode='ready', calls=0;
  const c=new QuotaController({ now:()=>clock, ttlMs:1000, load:async () => { calls++; if(mode==='pending') return new Promise(()=>{}); return { status:'ready', primary:{ label:'5h', remaining:60 } }; } });
  const a={ program:'codex', id:'a' };
  c.setTarget(a); await tick();
  assert.equal(c.lastReadyKey, 'codex:a');
  clock+=1001; mode='pending';
  c.setTarget(a);
  assert.equal(c.state.status, 'loading');
  assert.equal(c.lastReadyKey, 'codex:a');
  assert.equal(c.lastReady.primary.remaining, 60);
  // 切到另一个目标必须清掉旧数字。
  c.setTarget({ program:'codex', id:'b' });
  assert.equal(c.lastReadyKey, null);
  assert.equal(c.lastReady, null);
});

test('quotaKey 只按 program 与可靠 session 生成', () => {
  assert.equal(quotaKey({ program:'codex', id:'a' }), 'codex:a');
  assert.equal(quotaKey({ program:'claude', id:null }), 'claude:unknown');
  assert.equal(quotaKey(null), null);
});

test('CODEX_HOME 只从当前进程打开的会话路径推导', () => {
  assert.equal(sessionHome('/Users/x/.codex/sessions/2026/11/13/rollout-a.jsonl'), '/Users/x/.codex');
  assert.equal(sessionHome('/Users/x/alt/sessions/a.jsonl'), '/Users/x/alt');
  assert.equal(sessionHome('/tmp/a.jsonl'), null);
});

test('账号绑定要求 account 匹配且 provider 一致', () => {
  const files=[
    {meta:{creator_account_id:'acc1',model_provider:'openai'}},
    {meta:{creator_account_id:'acc1',model_provider:'openai'}},
    {meta:{creator_account_id:'acc2',model_provider:'openai'}},
  ];
  assert.equal(matchAccount(files,'acc1').status,'ok');
  assert.equal(matchAccount(files,'acc1').files.length,2);
  assert.equal(matchAccount(files,'acc9').status,'unknown');
  assert.equal(matchAccount(files,'acc1','anthropic').status,'unknown');
  const mixed=[{meta:{creator_account_id:'acc1',model_provider:'openai'}},{meta:{creator_account_id:'acc1',model_provider:''}}];
  assert.equal(matchAccount(mixed,'acc1').status,'unknown');
});

test('同账户多文件取最新新鲜快照，并列或过旧返回 unknown', () => {
  const now=2_000_000_000_000;
  assert.equal(pickFresh([{snapshotAt:now-1000},{snapshotAt:now-500}],now).snapshot.snapshotAt, now-500);
  assert.equal(pickFresh([{snapshotAt:now-1000},{snapshotAt:now-1000}],now).status,'unknown');
  assert.equal(pickFresh([{snapshotAt:now-30*60*1000}],now).status,'ok');
  assert.equal(pickFresh([{snapshotAt:now-61*60*1000}],now).status,'unknown');
  assert.equal(pickFresh([{snapshotAt:now-9_000_000}],now).status,'unknown');
  assert.equal(pickFresh([{snapshotAt:null}],now).status,'unknown');
});
