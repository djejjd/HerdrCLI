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

test('机器行按连接状态显示创建、登录或重连入口', async () => {
  const { machineAction } = await import('../mods/agents-order/unified-sidebar-index.js');
  assert.equal(machineAction(null, []), '+');
  assert.equal(machineAction('dev', [{name:'dev',layout:'ready'}]), '+');
  assert.equal(machineAction('dev', [{name:'dev',layout:'ready'}, {name:'dev',state:'needs_login'}]), '需登录');
  assert.equal(machineAction('dev', [{name:'dev',layout:'unavailable'}]), '重连');
});

test('统一项目树包含同一分屏里的 Shell 和 Agent，每个终端只列一次', async () => {
  const { sidebarAgents } = await import('../mods/agents-order/unified-sidebar-index.js');
  const agent = {address:'t1', space:'s', pane:'p1'};
  const terminals = ['t1','t2'].map(address => ({address,state:'live',foreground:{name:'zsh'}}));
  const panes = terminals.map((t,i) => ({terminal:t.address,pane:`p${i+1}`,tab:'tab'}));
  const spaces = [{id:'s',tabs:[{id:'tab',name:'构建'}]}];
  const rows = sidebarAgents([agent], terminals, panes, spaces, true);
  assert.deepEqual(rows.map(r => [r.address,r.pane]), [['t1','p1'],['t2','p2']]);
  assert.equal(rows[1].program.name,'Shell');
});

test('只展示所选机器项目，未连接的机器可为空', async () => {
  const { machineProjects } = await import('../mods/agents-order/unified-sidebar-index.js');
  const projects = [{id:'a'}, {id:'b',machine:'dev'}];
  assert.deepEqual(machineProjects(projects,null), [projects[0]]);
  assert.deepEqual(machineProjects(projects,'dev'), [projects[1]]);
  assert.deepEqual(machineProjects(projects,'offline'), []);
});

test('切换到分屏只放大一次，单窗和重复选择保持焦点', async () => {
  const { needsSinglePane } = await import('../mods/agents-order/unified-sidebar-index.js');
  const pane = {pane:'p1',tab:'t',zoomed:false};
  assert.equal(needsSinglePane([pane], 'p1'),false);
  const split = [pane,{pane:'p2',tab:'t',zoomed:true}];
  assert.equal(needsSinglePane(split,'p1'),true);
  assert.equal(needsSinglePane(split,'p2'),false);
});

test('仅当前 Space 显示创建动作，切换后目标跟随', async () => {
  const { terminalAction } = await import('../mods/agents-order/unified-sidebar-index.js');
  for (const active of ['a','b']) {
    const actions = ['a','b'].map(id => terminalAction({id,active:id === active})).filter(Boolean);
    assert.deepEqual(actions, [{space:active}]);
  }
});
