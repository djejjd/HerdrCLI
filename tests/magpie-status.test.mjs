import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaSelection, quotaLines } from '../mods/magpie-status/model.js';

test('额度跟随已确认路由，多个账号且归属未知时不显示任一账号额度', () => {
  const cards = [{provider:'codex',user:'a'}, {provider:'codex',user:'b'}, {provider:'deepseek'}];
  assert.equal(quotaSelection(cards, 'codex', null).current, null);
  assert.equal(quotaSelection(cards, 'codex', 'b').current, cards[1]);
  assert.equal(quotaSelection(cards, 'codex', 'other').current, null);
  assert.deepEqual(quotaSelection(cards, null, null).others, cards);
});

test('保留零额度并拒绝无效窗口', () => {
  assert.deepEqual(quotaLines({windows:[{name:'5h',remaining:0},{name:'week',remaining:null}]}), ['5h 剩 0%']);
});

test('底栏用 Codex 进程关联的唯一主会话，排除子 Agent 与旧进程', async () => {
  const { codexSessionQuery } = await import('../mods/magpie-status/model.js');
  const {execFileSync} = await import('node:child_process');
  const rows = execFileSync('sqlite3', ['-json', ':memory:', `
    ATTACH ':memory:' AS state;
    CREATE TABLE logs(thread_id, process_uuid, ts);
    CREATE TABLE state.threads(id, model, thread_source, source);
    INSERT INTO state.threads VALUES ('main','gpt-6','user','cli'), ('sub','other','subagent','{}'), ('old','old','user','cli');
    INSERT INTO logs VALUES ('main','pid:123:x',200), ('sub','pid:123:x',201), ('old','pid:123:y',99);
    ${codexSessionQuery(123, 100)}
  `], {encoding:'utf8'});
  assert.deepEqual(JSON.parse(rows), [{sessionId:'main',model:'gpt-6'}]);
});

test('OpenAI 路由可显示唯一 Codex 订阅参考额度，多卡时保持待确认', () => {
  const card = {provider:'codex',user:'a'};
  assert.equal(quotaSelection([card], 'openai', null).reference, card);
  assert.equal(quotaSelection([card,{provider:'codex',user:'b'}], 'openai', null).reference, null);
  assert.equal(quotaSelection([card], 'openai', 'other').reference, null);
});

test('额度色阶按各窗口单独计算，10% 正常，费用不参与告警', async () => {
  const {quotaReadings} = await import('../mods/magpie-status/model.js');
  const windows = [{name:'5 hours',remaining:10},{name:'7 days',remaining:9.9}];
  assert.deepEqual(quotaReadings({windows,balance:'¥0.01'}).map(r => r.low), [false,true,false]);
  assert.equal(quotaReadings({balance:0})[0].low,true);
  assert.deepEqual(quotaReadings({error:'offline',windows}),[]);
});

test('主会话使用 Astra 时，子 Agent 的 DeepSeek 请求不会替换模型或额度账号', async () => {
  const { modelRoute } = await import('../mods/magpie-status/model.js');
  assert.deepEqual(modelRoute('codex/gpt-6.2-astra', {
    model:'deepseek/deepseek-flash', served:{account:'child'},
  }), {model:'gpt-6.2-astra',provider:'codex',account:null});
  assert.deepEqual(modelRoute('codex/gpt-6.2-astra', {
    model:'openai/gpt-6.2-astra', served:{account:'main'},
  }), {model:'gpt-6.2-astra',provider:'codex',account:'main'});
  assert.deepEqual(modelRoute('magpie/deepseek/deepseek-flash', null),
    {model:'deepseek-flash',provider:'deepseek',account:null});
});
