import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaSelection, quotaLines } from '../mods/magpie-status/model.js';
import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

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

test('刷新空结果保留同一进程读数，不借用其他终端或重启进程的额度', async () => {
  const {modelReadingKey, rememberModelReading} = await import('../mods/magpie-status/model.js');
  const key = (address,pid) => modelReadingKey({address,foreground:{pid}});
  const cache = new Map();
  const original = {model:'gpt'};
  rememberModelReading(cache,key('t1',12),original);
  rememberModelReading(cache,key('t1',12),null);
  assert.equal(cache.get(key('t1',12)),original);
  assert.equal(cache.get(key('t2',12)),undefined);
  assert.equal(cache.get(key('t1',13)),undefined);
});

const execute = promisify(execFile);
const reader = fileURLToPath(new URL('../mods/magpie-status/read.mjs', import.meta.url));
const privateText = 'https://private.example/session?cookie=secret-token';

// 用隔离的 PATH 和 HTTP fixture 执行实际读取进程，无需本机账号或请求额度服务。
async function runReader(t, fixture) {
  const bin = await mkdtemp(join(tmpdir(), 'magpie-read-'));
  t.after(() => rm(bin, {recursive:true, force:true}));
  const outputs = {
    hc: JSON.stringify({state:'live', foreground:{name:'codex', pid:123, argv:['codex']}}),
    ps: 'Sun Nov 22 08:00:00 2026',
    sqlite3: JSON.stringify([{sessionId:'fixture-session', model:'codex/gpt-fixture'}]),
    node: JSON.stringify({sessionId:null}),
    ...fixture.commands,
  };
  for (const [command, output] of Object.entries(outputs)) {
    const script = output === false
      ? `#!/bin/sh\nprintf '%s\\n' '${privateText}' >&2\nexit 1\n`
      : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
    await writeFile(join(bin, command), script, {mode:0o700});
  }
  const preload = join(bin, 'fetch.mjs');
  await writeFile(preload, `
    const fixture = ${JSON.stringify(fixture)};
    globalThis.fetch = async url => {
      const isQuota = url.pathname.endsWith('/quotas') && url.searchParams.get('kept') === '1';
      const result = isQuota ? fixture.quota : fixture.route;
      if (result === 'timeout') throw new DOMException(${JSON.stringify(privateText)}, 'TimeoutError');
      if (result === 'offline') throw new Error(${JSON.stringify(privateText)});
      if (result === 'bad-json') return new Response(${JSON.stringify(privateText)});
      if (result === 'http-error') return new Response(${JSON.stringify(privateText)}, {status:503});
      if (result === 'not-found') return new Response(${JSON.stringify(privateText)}, {status:404});
      return Response.json(result ?? (isQuota ? {data:[{provider:'codex'}]} : {
        route:{model:'codex/gpt-fixture', served:{account:'fixture-account'}},
      }));
    };
  `);
  const observed = await execute(process.execPath, ['--import', preload, reader, 't1'], {
    cwd:dirname(reader),
    env:{...process.env, PATH:bin + ':/usr/bin:/bin'},
  });
  assert.equal(observed.stderr, '');
  assert.ok(!observed.stdout.includes(privateText));
  return JSON.parse(observed.stdout);
}

test('额度超时仍返回已核验路由，只输出固定原因', async t => {
  assert.deepEqual(await runReader(t, {quota:'timeout'}), {
    cards:null,
    route:{model:'gpt-fixture', provider:'codex', account:'fixture-account'},
    failures:[{stage:'quota', reason:'timeout'}],
  });
});

test('路由响应无效时保留额度与会话模型', async t => {
  assert.deepEqual(await runReader(t, {route:'bad-json'}), {
    cards:[{provider:'codex'}],
    route:{model:'gpt-fixture', provider:'codex', account:null},
    failures:[{stage:'route', reason:'invalid-response'}],
  });
});

test('本地身份查询失败与额度请求失败分别报告，无原始诊断正文', async t => {
  assert.deepEqual(await runReader(t, {commands:{hc:false}, quota:'offline'}), {
    cards:null,
    route:null,
    failures:[{stage:'quota', reason:'unavailable'}, {stage:'terminal', reason:'unavailable'},
      {stage:'session', reason:'unavailable'}],
  });
});

test('进程启动时间无效时能区分与主会话尚未确认', async t => {
  assert.deepEqual(await runReader(t, {commands:{ps:'a non-date'}}), {
    cards:[{provider:'codex'}],
    route:null,
    failures:[{stage:'codex-process', reason:'invalid-response'}, {stage:'session', reason:'not-found'}],
  });
});

test('额度服务拒绝请求与路由尚未记录使用各自的原因', async t => {
  assert.deepEqual(await runReader(t, {quota:'http-error', route:'not-found'}), {
    cards:null,
    route:{model:'gpt-fixture', provider:'codex', account:null},
    failures:[{stage:'quota', reason:'http-error'}, {stage:'route', reason:'not-found'}],
  });
});

test('Codex 数据库读取失败，回退没有验证到会话时报告两个阶段', async t => {
  assert.deepEqual(await runReader(t, {commands:{sqlite3:false}}), {
    cards:[{provider:'codex'}],
    route:null,
    failures:[{stage:'codex-session', reason:'unavailable'}, {stage:'session', reason:'not-found'}],
  });
});

test('Codex 数据库读取失败时使用已核验的回退会话', async t => {
  assert.deepEqual(await runReader(t, {commands:{sqlite3:false, node:JSON.stringify({sessionId:'fixture-session'})}}), {
    cards:[{provider:'codex'}],
    route:{model:'gpt-fixture', provider:'codex', account:'fixture-account'},
    failures:[],
  });
});

test('全部读取得到有效结果时返回正常读数及空摘要', async t => {
  assert.deepEqual(await runReader(t, {}), {
    cards:[{provider:'codex'}],
    route:{model:'gpt-fixture', provider:'codex', account:'fixture-account'},
    failures:[],
  });
});
