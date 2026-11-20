import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarIndex, machineNames } from '../mods/agents-order/unified-sidebar-index.js';
import { projectedPositions } from '../mods/agents-order/order.js';

test('本机单独显示，远端空机保留，同名项目按 ID 归属', () => {
  const spaces = [{id:'a',name:'api'},{id:'b',name:'api',machine:'office'},{id:'c',name:'empty'}];
  const agents = [{address:'t1',space:'a',status:'idle'},{address:'office/t1',space:'b',status:'blocked'}];
  const items = new Map([['office/t1',[{displayState:'review'},{displayState:'needs_user'}]]]);
  const tree = sidebarIndex(spaces,agents,items);
  assert.deepEqual(machineNames([],[]), []);
  assert.deepEqual(machineNames(spaces,['offline']),[null,'office','offline']);
  assert.deepEqual(tree.members.get('a'),[agents[0]]);
  assert.deepEqual(tree.members.get('c'),[]);
  assert.equal(tree.pending.get('office'),2);
  assert.equal(tree.pending.get(null) ?? 0,0);
  assert.deepEqual(projectedPositions(tree.members.get('a'),'t1',0,new Map()),new Map([['t1',0]]));
});

test('拖拽图标只在当前可排序行的手柄上出现', async () => {
  const { showGrip } = await import('../mods/agents-order/order.js');
  assert.equal(showGrip({address:'t1'}, 2, null), false);
  assert.equal(showGrip({address:'t1'}, 2, 't1'), true);
  assert.equal(showGrip({address:'t1'}, 2, 't2'), false);
  assert.equal(showGrip({address:'t1', pinned:true}, 2, 't1'), false);
  assert.equal(showGrip({address:'t1'}, 1, 't1'), false);
});

test('Space 落点按同机顺序计算，跨机、自身、消失目标均不提交', async () => {
  const { spaceMove } = await import('../mods/agents-order/unified-sidebar-index.js');
  const list = ['a','b','c'].map(id => ({id,machine:null}));
  list.push({id:'remote/x',machine:'remote'});
  assert.deepEqual(spaceMove(list,'a','c',false),{id:'a',index:2});
  assert.deepEqual(spaceMove(list,'a','c',true),{id:'a',index:3});
  assert.deepEqual(spaceMove(list,'c','a',false),{id:'c',index:1});
  for (const target of ['a','b','remote/x','gone']) assert.equal(spaceMove(list,'a',target,false),null);
});

test('前台 OpenCode 随进程出现和退出，真实状态优先', async () => {
  const { sidebarAgents } = await import('../mods/agents-order/unified-sidebar-index.js');
  const terminal = {address:'t3k',state:'live',foreground:{name:'opencode'}};
  const panes = [{terminal:'t3k',pane:'p',tab:'tab'}];
  const spaces = [{id:'s',tabs:[{id:'tab',name:'my_opencode'}]}];
  const rows = reported => sidebarAgents(reported,[terminal],panes,spaces);
  assert.deepEqual(rows([]).map(a => [a.address,a.space,a.status]),[['t3k','s','unknown']]);
  const native = {address:'t3k',status:'working'};
  assert.deepEqual(rows([native]),[native]);
  terminal.foreground.name = 'zsh';
  assert.deepEqual(rows([]),[]);
});
