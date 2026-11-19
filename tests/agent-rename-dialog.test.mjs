// 用宿主替身驱动真实弹窗的保存入口，覆盖写入回执和关窗的先后关系。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as names from '../mods/agents-order/names.js';

const source = readFileSync(new URL('../mods/agents-order/main.js', import.meta.url), 'utf8');
function dialog(write, overrides = {}) {
  const calls = [];
  const host = { ...names, View: class {}, props: () => ({ name:'旧名', address:'a', overlay:'dialog' }),
    hc: write, closeOverlay: id => calls.push(id), panes: () => [], agents: () => [], ...overrides };
  const body = source.replace(/^import .*;$/gm, '').replace('export default class Agents','return class Agents');
  const Agent = Function(...Object.keys(host),body)(...Object.values(host));
  const view = new Agent();
  view.input = { value: () => '新名' };
  let pending;
  const cx = { notify() {}, spawn(fn) { pending = fn(cx); } };
  return { view, calls, save() { view.saveName(cx); return pending; } };
}

test('标签写入成功即关窗，同一次保存只写一次', async () => {
  let release, writes = 0;
  const d = dialog(() => { writes++; return new Promise(ok => { release = ok; }); });
  const done = d.save();
  d.save();
  assert.deepEqual(d.calls, []);
  release({code:0});
  await done;
  assert.equal(writes,1);
  assert.deepEqual(d.calls,['dialog']);
});

test('写入失败保留输入，重试成功后关窗', async () => {
  let tries = 0;
  const d = dialog(async () => ({code: ++tries === 1 ? 1 : 0}));
  await d.save();
  assert.deepEqual(d.calls,[]);
  assert.match(d.view.renameError,/未保存/);
  assert.equal(d.view.input.value(),'新名');
  await d.save();
  assert.deepEqual(d.calls,['dialog']);
});

test('弹窗在标签回显前关闭，侧栏复查延迟回显和超时', async () => {
  for (const timeout of [false, true]) {
    const store = new Map(), warnings = [], commands = [];
    const tab = {id:'tab1', name:'旧名'};
    const d = dialog(async () => ({code:0}), {
      panes: () => [{tab:'tab1', terminal:'a'}],
      agents: () => [{address:'a',tab:'tab1'}],
      spaces: () => [{tabs:[tab]}],
      shared: key => store.get(key),
      setShared: (key,value) => store.set(key,value),
      notify: message => warnings.push(message),
      run: (cmd, args) => commands.push([cmd,args]),
    });
    await d.save();
    assert.deepEqual(d.calls,['dialog']);
    assert.deepEqual(commands,[['tab.rename',{id:'tab1',name:'新名'}]]);
    const sidebar = new d.view.constructor();
    let tick;
    const cx = {timer:{after(_ms, fn) { tick = fn; return {}; }}, notify() {}};
    sidebar.checkTabEchoes(cx);
    assert.equal(warnings.length,0);
    if (timeout) store.get('agents.rename.pendingTabEchoes').tab1.at -= 650;
    else tab.name = '新名';
    tick(cx);
    sidebar.checkTabEchoes(cx);
    assert.equal(store.get('agents.rename.pendingTabEchoes'),null);
    assert.equal(warnings.length,Number(timeout));
  }
});

test('右键弹窗独立读取同一工作区已有名称', () => {
  let request;
  const d = dialog(async () => ({code:0}), {
    terminals: () => [{address:'other',labels:{'workbench.name':'已占用'}}],
    agents: () => ['a','other'].map(address => ({address,space:'space1',program:{name:'Codex'}})),
    openOverlay: spec => { request = spec.props; },
  });
  d.view.renameByAddress('a');
  assert.equal(names.validateEdit('', '已占用', request.siblings),'当前 Space 已有同名任务');
});
