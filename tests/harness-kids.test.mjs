import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as kids from '../mods/agents-order/harness-kids.js';
const {childRows} = kids;
const row={id:'one',name:'review',model:'small',state:'review'};
test('两父进程隔离，状态由子项独立上报',()=>{const packet={version:1,pid:12,children:[row,row]}; assert.deepEqual(childRows(packet,13),[]);assert.deepEqual(childRows(packet,12),[row]);});
test('坏数据和未知协议不渲染',()=>{assert.deepEqual(childRows({version:2,pid:3,children:[row]},3),[]);assert.deepEqual(childRows(null,3),[]);});

test('明确完成能穿过公共协议',()=>{assert.equal(childRows({version:1,pid:12,children:[{...row,state:'completed'}]},12)[0].state,'completed');});

const identity = 'a'.repeat(32);
const local = {address:'t1',created_ms:500,foreground:{name:'codex',pid:12}};
const packet = (stage, extra = {}) => ({version:1,pid:12,stage,children:[],...extra});
const result = payload => ({code:0,stdout:JSON.stringify({12:payload})});

test('相同父身份的已验证子项，阶段失败时保留但显示未知', () => {
  const visible = childRows(packet('children',{identity,children:[row]}),12);
  assert.deepEqual(visible,[{...row,state:'unknown',reading:'子会话关系读取失败'}]);
});

test('读数批次为已验证父身份保留子项，并在恢复成功空列表时清除缓存', () => {
  const {updateChildPackets, childPacketFor} = kids;
  const ready = result(packet('ready',{identity,children:[row],parentState:'completed'}));
  const first = updateChildPackets(null,[local],[local],ready);
  assert.deepEqual(childRows(childPacketFor(local,first),12),[row]);
  const second = updateChildPackets(first,[local],[local],result(packet('children',{identity})));
  assert.deepEqual(childRows(childPacketFor(local,second),12),[{...row,state:'unknown',reading:'子会话关系读取失败'}]);
  assert.equal(childPacketFor(local,second).parentState,undefined);
  const third = updateChildPackets(second,[local],[local],result(packet('ready',{identity})));
  assert.deepEqual(childRows(childPacketFor(local,third),12),[]);
});

test('身份失败、变化或终端重建时不展示旧父会话的行', () => {
  const {updateChildPackets, childPacketFor} = kids;
  const ready = result(packet('ready',{identity,children:[row]}));
  const first = updateChildPackets(null,[local],[local],ready);
  const restarted = {...local,created_ms:501};
  assert.equal(childPacketFor(restarted,first),null);
  const pending = updateChildPackets(first,[local],[restarted],ready);
  assert.equal(childPacketFor(restarted,pending),null);
  for (const snapshot of [packet('identity'), packet('children',{identity:'b'.repeat(32)})]) {
    const next = updateChildPackets(first,[local],[local],result(snapshot));
    const visible = childRows(childPacketFor(local,next),12);
    assert.equal(visible[0].state,'unknown');
    assert.equal(visible[0].id,null);
    assert.notEqual(visible[0].name,row.name);
  }
});

test('畸形发布标签回到本机读数，子进程异常只显示固定阶段', () => {
  const {updateChildPackets, childPacketFor} = kids;
  const first = updateChildPackets(null,[local],[local],result(packet('ready',{identity,children:[row]})));
  const invalidLabel = {...local,labels:{'workbench.children.v1':'{"secret":'}};
  assert.deepEqual(childRows(childPacketFor(invalidLabel,first),12),[row]);
  const broken = updateChildPackets(first,[local],[local],{code:0,stdout:'{"secret":'});
  const rows = childRows(childPacketFor(local,broken),12);
  assert.deepEqual(rows,[{id:null,name:'子会话读取响应无效',model:'',state:'unknown'}]);
  const unavailable = updateChildPackets(first,[local],[local],{code:1,stderr:'private details'});
  assert.equal(childRows(childPacketFor(local,unavailable),12)[0].name,'子会话读取进程失败');
});

test('畸形 rollout 记录只让该子项未知，并保留其他子项', () => {
  const reader = fileURLToPath(new URL('../mods/agents-order/codex-children.py',import.meta.url));
  const run = execFileSync('python3',['-B','-c',`
import importlib.util, json, pathlib, sqlite3, sys, tempfile
from contextlib import closing

spec = importlib.util.spec_from_file_location('codex_children', sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with tempfile.TemporaryDirectory() as fixture:
    root = pathlib.Path(fixture)
    mod.ROOT = root
    mod.subprocess.check_output = lambda *args, **kwargs: 'Sun Nov 22 09:00:00 2026'
    for file, payload in [('parent',{'type':'task_started'}),('good',{'type':'task_complete','turn_id':'a-turn'}),('bad',[])]:
        (root/file).write_text(json.dumps({'type':'event_msg','payload':payload}))
    with closing(sqlite3.connect(root/'logs_2.sqlite')) as logs:
        logs.execute('CREATE TABLE logs(thread_id, process_uuid, ts)')
        logs.execute("INSERT INTO logs VALUES ('parent','pid:12:fixture',9999999999)")
        logs.commit()
    with closing(sqlite3.connect(root/'state_5.sqlite')) as state:
        state.execute('CREATE TABLE threads(id, rollout_path, thread_source, source, agent_path, model, created_at, updated_at_ms)')
        state.executemany('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
            (name,str(root/name),'user' if name == 'parent' else 'subagent','cli',name,'model',idx,100+idx)
            for idx,name in enumerate(('parent','good','bad'))
        ])
        state.execute('CREATE TABLE thread_spawn_edges(parent_thread_id, child_thread_id, status)')
        state.executemany('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)', [
            ('parent','good','open'), ('parent','bad','open'),
        ])
        state.commit()
        good = mod.snapshot(12)
        (root/'good').write_text(json.dumps({'type':'event_msg','payload':{'type':'task_complete','turn_id':'new-turn'}}))
        newer = mod.snapshot(12)
        state.execute('DROP TABLE thread_spawn_edges')
        state.commit()
        failed = mod.snapshot(12)
        print(json.dumps([good,newer,failed]))
`,reader],{encoding:'utf8'});
  const [ok, newer, failed] = JSON.parse(run);
  assert.equal(ok.stage,'ready');
  assert.match(ok.identity,/^[a-f0-9]{32}$/);
  assert.deepEqual(ok.children.map(child => [child.id,child.state]),[['bad','unknown'],['good','completed']]);
  assert.ok(Number.isSafeInteger(ok.children[1].revision));
  assert.notEqual(newer.children[1].revision,ok.children[1].revision);
  assert.deepEqual(failed,{stage:'children',identity:ok.identity,children:[]});
});
