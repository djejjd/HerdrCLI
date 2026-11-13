// 工作台行为测试：任务标识、跨窗口顺序和恢复失败语义。
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskName, ordered, reorder, validateName, recovery, classify, recordKey, dragTarget, recentAction, pointerInBounds, isDragMove, dragOutcome, dropRecent, failurePrompt, dispatchFailure, tabSyncPlan, spaceTerminals, terminalSection, toggleTerminalFold, terminalSectionRows, parseFoldState, serializeFoldState, foldedFrom, terminalRows, terminalName, duplicateNames } from '../mods/agent-workbench/model.js';
test('名称不从对话标题提取', () => {
  assert.equal(taskName({program:{name:'Codex'},title:'用户的完整输入'}, {}), 'Codex');
  assert.equal(taskName({program:{name:'Codex'}}, {'workbench.name':'登录修复'}), '登录修复');
});
test('简短名称拒绝空白、长名称和同组重名', () => {
  assert.ok(validateName('',[])); assert.ok(validateName('一'.repeat(17),[]));
  assert.ok(validateName('登录修复',['登录修复'])); assert.equal(validateName('接口审查',[]),null);
});
test('状态变化不改变手动顺序，新增项位于末尾', () => {
  assert.deepEqual(ordered([{address:'a',status:'blocked'},{address:'b'},{address:'c'}],{a:2,b:1}).map(x=>x.address),['b','a','c']);
});
test('重排仅接受当前组的地址', () => {
  assert.deepEqual(reorder(['a','b','c'],'a',2),['b','c','a']);
  assert.deepEqual(reorder(['a','b'],'other',1),['a','b']);
});
test('缺少可靠会话身份时明确失败，不猜测最新会话', () => {
  const r=recovery({program:'codex'}); assert.equal(r.state,'failed'); assert.ok(r.reason);
});
test('原终端仍在运行时不可重复恢复', () => {
  assert.equal(recovery({program:'codex'},true).state,'live');
});
test('精确验证的会话 ID 使用对应恢复命令',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  assert.deepEqual(recovery({program:'codex',sessionId:id,verified:true}).argv,['codex','--no-daemon','resume',id]);
  assert.equal(recovery({program:'codex',sessionId:id}).state,'failed');
});
test('不把工作完成误判为会话关闭', () => {
  assert.equal(classify({state:'live',foreground:{name:'codex'}},true),'active');
  assert.equal(classify({state:'live',foreground:{name:'zsh'}},false),'closed');
  assert.equal(classify(null,false),'interrupted');
});
test('同一个终端不同进程不会覆盖历史',()=>{
  assert.notEqual(recordKey('t1',{'workbench.pid':'10'}),recordKey('t1',{'workbench.pid':'20'}));
});

test('拖动位移换算出目标行并夹在两端', () => {
  assert.equal(dragTarget(1, 0, 46, 4), 1);
  assert.equal(dragTarget(1, 20, 46, 4), 1);
  assert.equal(dragTarget(1, 30, 46, 4), 2);
  assert.equal(dragTarget(1, 46, 46, 4), 2);
  assert.equal(dragTarget(1, -92, 46, 4), 0);
  assert.equal(dragTarget(1, 400, 46, 4), 3);
  assert.equal(dragTarget(0, -50, 46, 0), 0);
});

test('最近会话动作区分恢复、新建与未知状态', () => {
  assert.equal(recentAction({state:'recent'}), 'restore');
  assert.equal(recentAction({state:'failed'}), 'fresh');
  assert.equal(recentAction({state:'active'}), 'none');
  assert.equal(recentAction(null), 'none');
});

test('拖动轮询用带原点的窗口边界判断指针', () => {
  const b={x:12,y:40,width:300,height:900};
  assert.equal(pointerInBounds({x:12,y:40},b), true);
  assert.equal(pointerInBounds({x:311.9,y:939.9},b), true);
  assert.equal(pointerInBounds({x:11.9,y:40},b), false);
  assert.equal(pointerInBounds({x:12,y:39.9},b), false);
  assert.equal(pointerInBounds({x:312,y:100},b), false);
  assert.equal(pointerInBounds({x:100,y:940},b), false);
  assert.equal(pointerInBounds(null,b), false);
  assert.equal(pointerInBounds({x:1,y:1},null), false);
});

test('4px 边界用未夹紧的指针位移判定，首末行反向拖不误判单击', () => {
  assert.equal(dragOutcome({ dy: 0, rawDy: -12, target: 0, index: 0, valid: true }), 'noop');
  assert.equal(dragOutcome({ dy: 0, rawDy: -12, target: 0, index: 1, valid: true }), 'reorder');
  assert.equal(dragOutcome({ dy: 20, rawDy: 2, target: 2, index: 1, valid: true }), 'focus');
  assert.equal(dragOutcome({ dy: 0, rawDy: -12, target: 0, index: 1, valid: false }), 'cancel');
});

test('位移阈值与拖动终态：单击不写标签，取消不触发聚焦', () => {
  assert.equal(isDragMove(0), false);
  assert.equal(isDragMove(4), false);
  assert.equal(isDragMove(4.1), true);
  assert.equal(isDragMove(-4.1), true);
  assert.equal(dragOutcome(null), 'none');
  assert.equal(dragOutcome({dy:2,target:1,index:1,valid:true}), 'focus');
  assert.equal(dragOutcome({dy:20,target:1,index:1,valid:false}), 'cancel');
  assert.equal(dragOutcome({dy:20,target:1,index:1,valid:true}), 'noop');
  assert.equal(dragOutcome({dy:20,target:2,index:1,valid:true}), 'reorder');
});

test('删除最近会话记录：只移除目标，其余条目与原对象不受影响', () => {
  const history={ 't1:10:abc':{address:'t1',state:'failed',reason:'x'}, 't2:20:def':{address:'t2',state:'recent'}, 't1:30:ghi':{address:'t1',state:'recent'} };
  const next=dropRecent(history,'t1:10:abc');
  assert.deepEqual(Object.keys(next).sort(),['t1:30:ghi','t2:20:def']);
  assert.equal(next['t1:30:ghi'].state,'recent');
  assert.ok(history['t1:10:abc'],'原快照不被就地修改');
  assert.equal(next['t2:20:def'],history['t2:20:def'],'未删除条目保持同一引用');
});

test('删除不存在的记录不产生新对象，空快照也安全', () => {
  const history={a:{state:'failed'}};
  assert.equal(dropRecent(history,'missing'),history);
  assert.deepEqual(dropRecent(undefined,'a'),{});
  assert.deepEqual(dropRecent(null,'a'),{});
});

test('恢复失败弹窗保留原因原话，并给出新建与删除两个动作', () => {
  const p=failurePrompt('未获取到可验证的原会话 ID，无法恢复上下文');
  assert.equal(p.reason,'未获取到可验证的原会话 ID，无法恢复上下文');
  assert.deepEqual(p.actions.map(a=>a.id),['fresh','dismiss']);
  assert.equal(p.actions[0].primary,true);
  assert.ok(failurePrompt('').reason.length>0,'原因为空时也要有可读文案');
});

test('失败弹窗取消/未知动作不执行任何处理器', () => {
  const calls=[];
  const handlers={fresh:()=>calls.push('fresh'),dismiss:()=>calls.push('dismiss')};
  assert.equal(dispatchFailure(undefined,handlers),null);
  assert.equal(dispatchFailure('cancel',handlers),null);
  assert.deepEqual(calls,[]);
  assert.equal(dispatchFailure('fresh',{}),null);
});

test('选择新建只调用一次 fresh，不触碰删除', () => {
  const calls=[];
  dispatchFailure('fresh',{fresh:()=>calls.push('fresh'),dismiss:()=>calls.push('dismiss')});
  assert.deepEqual(calls,['fresh']);
});

test('选择删除移除记录，重复删除不再变化', () => {
  const history={'t1:10:abc':{address:'t1',state:'failed',reason:'x'},'t2:20:def':{address:'t2',state:'recent'}};
  const once=dispatchFailure('dismiss',{dismiss:()=>dropRecent(history,'t1:10:abc')});
  assert.deepEqual(Object.keys(once),['t2:20:def']);
  assert.equal(dispatchFailure('dismiss',{dismiss:()=>dropRecent(once,'t1:10:abc')}),once);
});

test('点遮罩关闭失败弹窗：不写记录，也不调 fresh/dropRecent', () => {
  const history={'t1:10:abc':{address:'t1',state:'failed',reason:'x'}};
  const calls=[];
  const handlers={fresh:()=>calls.push('fresh'),dismiss:()=>calls.push('dismiss')};
  assert.equal(dispatchFailure('mask',handlers),null);
  assert.deepEqual(calls,[]);
  assert.equal(history['t1:10:abc'].state,'failed');
});

test('Esc 关闭失败弹窗同样零副作用', () => {
  const history={'t1:10:abc':{address:'t1',state:'failed',reason:'x'}};
  const calls=[];
  const handlers={fresh:()=>calls.push('fresh'),dismiss:()=>calls.push('dismiss')};
  assert.equal(dispatchFailure('escape',handlers),null);
  assert.deepEqual(calls,[]);
  assert.equal(history['t1:10:abc'].state,'failed');
});

test('tab 同步只在独占 tab 上发生：同 tab 还有别的终端就不改名', () => {
  const panes=[{tab:'tab-a',terminal:'t16'},{tab:'tab-b',terminal:'t20'},{tab:'tab-b',terminal:'t21'}];
  const solo={address:'t16',tab:'tab-a',tab_name:'ds-task'};
  const shared={address:'t20',tab:'tab-b',tab_name:'ds-verify'};
  assert.ok(tabSyncPlan(panes,solo,'ds牛马3号'));
  assert.equal(tabSyncPlan(panes,shared,'ds牛马1号'),null);
});

test('tab 改名参数用 tab id 与工作台名', () => {
  const panes=[{tab:'tab-a',terminal:'t16'}];
  assert.deepEqual(tabSyncPlan(panes,{address:'t16',tab:'tab-a',tab_name:'ds-task'},'ds牛马3号'),{id:'tab-a',name:'ds牛马3号'});
});

test('共用 tab、无 tab、已同名都返回 null，调用方不得改 tab', () => {
  assert.equal(tabSyncPlan([],{address:'t16'},'名字'),null);
  assert.equal(tabSyncPlan([{tab:'tab-a',terminal:'t16'}],{address:'t16',tab:'tab-a',tab_name:'同名'},'同名'),null);
  assert.equal(tabSyncPlan([{tab:'tab-a',terminal:'t16'}],{address:'t16',tab:'tab-a',tab_name:'x'},''),null);
});

const T=(address,space,extra={})=>({address,state:'live',labels:{'herdr.space':space},...extra});

test('终端区只收本 Space、live、无 agent 状态、有 pane 的终端', () => {
  const terms=[
    T('t1','s1'), T('t6','s1'), T('t8','s2'),
    {...T('t9','s1'),state:'dead'},
    {...T('t10','s1'),labels:{'herdr.space':'s1'}},
  ];
  const agents=[{address:'t10',space:'s1'}];
  const panes=[{terminal:'t1'},{terminal:'t6'},{terminal:'t8'},{terminal:'t10'}];
  const got=spaceTerminals(terms,agents,panes,'s1').map(x=>x.address);
  assert.deepEqual(got,['t1','t6']);
});

test('无 pane 的后台子 agent 终端不进入终端区', () => {
  const terms=[T('t1','s1'),T('t2a','s1')];
  const panes=[{terminal:'t1'}];
  assert.deepEqual(spaceTerminals(terms,[],panes,'s1').map(x=>x.address),['t1']);
});

test('同名终端都保留，不因重名丢条目', () => {
  const terms=[T('t6','s1',{name:'zsh'}),T('t1k','s1',{name:'zsh'})];
  const got=spaceTerminals(terms,[],[{terminal:'t6'},{terminal:'t1k'}],'s1');
  assert.deepEqual(got.map(x=>x.address),['t6','t1k']);
  assert.deepEqual([...duplicateNames(got)],['zsh']);
});

test('每个 Space 最多直接显示 3 条，其余用「还有 N 条」', () => {
  const list=[1,2,3,4,5].map(i=>T('t'+i,'s1'));
  assert.deepEqual(terminalRows(list,false).shown.map(x=>x.address),['t1','t2','t3']);
  assert.equal(terminalRows(list,false).more,2);
  assert.equal(terminalRows(list,true).shown.length,5);
  assert.equal(terminalRows(list,true).more,0);
  assert.equal(terminalRows([],false).more,0);
});

test('终端显示名优先级：工作台名 > name > title > 地址', () => {
  assert.equal(terminalName(T('t1','s1',{name:'zsh',title:'~/x',labels:{'herdr.space':'s1','workbench.name':'脚本'}})),'脚本');
  assert.equal(terminalName(T('t1','s1',{name:'zsh'})),'zsh');
  assert.equal(terminalName(T('t1','s1',{title:'~/x'})),'~/x');
  assert.equal(terminalName(T('t1','s1')),'t1');
});

test('重名集合只包含重复的名字', () => {
  const dup=duplicateNames([T('t1','s1',{name:'a'}),T('t2','s1',{name:'b'}),T('t3','s1',{name:'a'})]);
  assert.deepEqual([...dup],['a']);
});

test('终端小节标题固定为「终端」，计数独立，不拼成「终端 N」', () => {
  const h = terminalSection(3);
  assert.equal(h.title, '终端');
  assert.equal(h.count, 3);
  assert.doesNotMatch(h.title, /\d/);
  assert.equal(terminalSection(0).count, 0);
});

test('终端小节折叠状态按 Space 隔离，toggle 返回新集合', () => {
  const a = toggleTerminalFold(new Set(), 's1');
  assert.ok(a.has('s1'));
  assert.equal(toggleTerminalFold(new Set(), 's1').has('s2'), false);
  const b = toggleTerminalFold(a, 's2');
  assert.deepEqual([...b].sort(), ['s1','s2']);
  assert.deepEqual([...a], ['s1'], '原集合不被就地修改');
  assert.deepEqual([...toggleTerminalFold(b, 's1')], ['s2']);
});

test('折叠时不渲染终端行，也不显示「还有 N 条」', () => {
  const list=[1,2,3,4,5].map(i=>T('t'+i,'s1'));
  const folded=terminalSectionRows(list,{folded:true,expanded:true});
  assert.deepEqual(folded.shown, []);
  assert.equal(folded.more, 0);
  assert.equal(folded.folded, true);
});

test('未折叠时默认 3 条，展开后全部', () => {
  const list=[1,2,3,4,5].map(i=>T('t'+i,'s1'));
  assert.equal(terminalSectionRows(list,{folded:false,expanded:false}).shown.length, 3);
  assert.equal(terminalSectionRows(list,{folded:false,expanded:false}).more, 2);
  assert.equal(terminalSectionRows(list,{folded:false,expanded:true}).shown.length, 5);
  assert.equal(terminalSectionRows(list,{folded:false,expanded:true}).more, 0);
});

test('终端折叠状态序列化/反序列化：只存 Space id → true', () => {
  const raw = serializeFoldState(new Set(['s1','s3']));
  assert.deepEqual(JSON.parse(raw), { s1:true, s3:true });
  assert.deepEqual([...foldedFrom(parseFoldState(raw))].sort(), ['s1','s3']);
});

test('坏 JSON、未知结构与非布尔值都不崩，按未折叠处理', () => {
  assert.deepEqual(parseFoldState('{oops'), {});
  assert.deepEqual(parseFoldState('null'), {});
  assert.deepEqual(parseFoldState('[1,2]'), {});
  assert.deepEqual(parseFoldState('{"s1":"yes","s2":0,"s3":true}'), { s3:true });
  assert.deepEqual([...foldedFrom(parseFoldState(undefined))], []);
});
