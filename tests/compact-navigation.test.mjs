import test from 'node:test';
import assert from 'node:assert/strict';
import { partition, taskName, matches } from '../mods/compact-tabs/navigation.js';
import { spacesHeight } from '../mods/compact-spaces/height.js';

test('十二个标签中保留固定项、当前项、最近项，后台状态不重排', () => {
  const tabs = Array.from({length:12}, (_,i) => ({id:String(i),active:i===9}));
  const visible = () => partition(tabs,['4'],['9','7'],3).map(t=>t.id);
  assert.deepEqual(visible(), ['4','7','9']);
  tabs[0].status = 'blocked';
  assert.deepEqual(visible(), ['4','7','9']);
  assert.deepEqual(partition(tabs,['4'],[],1).map(t=>t.id), ['9']);
});
test('任务名保留且搜索支持工具和终端号', () => {
  assert.equal(taskName('评估界面','Action Required | 评估界面'), '评估界面');
  assert.equal(taskName('', 'Action Required | 修复搜索'), '修复搜索');
  for (const q of ['codex','界面','t3b']) assert.ok(matches(['评估界面','Codex','t3b'], q));
});
test('项目少时收紧，项目多时封顶', () => {
  assert.ok(spacesHeight(3,1) < spacesHeight(6,1));
  assert.equal(spacesHeight(30,1), spacesHeight(60,1));
});

test('按每个标题的宽度决定溢出并保留活动标签', async () => {
  const {fitTabs, menuOrder} = await import('../mods/compact-tabs/navigation.js');
  const list = ['a','b','c'].map(id => ({id, active:id === 'c'}));
  const widths = new Map([['a',65],['b',115],['c',100]]);
  assert.deepEqual(fitTabs(list, [], ['c','b'], widths, 280), list);
  assert.deepEqual(fitTabs(list, [], ['c','b'], widths, 245), list.slice(1));
  assert.deepEqual(menuOrder(list,'b').map(t => t.id), ['c','b','a']);
});

test('未命名 shell 使用目录，同名补终端号，尊重手工标签和 Agent 任务名', async () => {
  const {terminalTitles} = await import('../mods/compact-tabs/navigation.js');
  const entries = [
    {id:'a',shell:true,cwd:'/code/api',address:'t3',name:'zsh'},
    {id:'b',shell:true,cwd:'C:\\Code\\api',address:'t4',name:'pwsh'},
    {id:'c',shell:true,cwd:'/code/api',manual:'日志',name:'zsh'},
    {id:'d',name:'编写测试',cwd:'/code/api',address:'t5'},
    {id:'e',shell:true,cwd:'/',name:'zsh'},
  ];
  assert.deepEqual([...terminalTitles(entries).values()], ['api · t3','api · t4','日志','编写测试','/']);
});
