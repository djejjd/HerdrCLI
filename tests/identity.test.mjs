// 精确 PID 对应、后台多会话及旧进程拒绝行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountedIdentity,descendants,selectedIdentity } from '../mods/agent-workbench/identity.js';
import { recordKey,recovery } from '../mods/agent-workbench/model.js';
const id='12345678-1234-1234-1234-123456789abc';
test('DeepSeek 精确匹配当前终端子进程',()=>{
  const pids=descendants(10,[[11,10],[12,11],[20,1]]);
  assert.deepEqual(pids,[10,11,12]);
  assert.equal(mountedIdentity({version:1,owners:[{pid:12,sessionIds:[id]},{pid:20,sessionIds:['other']}]},pids),id);
});
test('多个挂载、未知版本、其他进程均不猜测',()=>{
  assert.equal(mountedIdentity({version:1,owners:[{pid:10,sessionIds:[id,'22345678-1234-1234-1234-123456789abc']}]},[10]),null);
  assert.equal(mountedIdentity({version:2,owners:[]},[10]),null);
  assert.equal(mountedIdentity({version:1,owners:[{pid:20,sessionIds:[id]}]},[10]),null);
});
test('OpenCode 只认目标进程的已选择会话',()=>{
  assert.equal(selectedIdentity([{pid:10,sessionId:'ses_abc123'}],[10]),'ses_abc123');
  assert.equal(selectedIdentity([{pid:20,sessionId:'ses_other'}],[10]),null);
  assert.equal(selectedIdentity([{pid:10,sessionId:'invalid'}],[10]),null);
});
test('同一进程切换会话保留不同记录',()=>{
  assert.notEqual(recordKey('t1',{'workbench.pid':'10','workbench.session':'ses_a'}),recordKey('t1',{'workbench.pid':'10','workbench.session':'ses_b'}));
});
test('四种 Agent 只使用验证过的明确 ID 恢复',()=>{
  assert.deepEqual(recovery({program:'dsh-tui',verified:true,sessionId:id}).argv,['dsh-tui','--resume',id]);
  assert.deepEqual(recovery({program:'opencode',verified:true,sessionId:'ses_abc123'}).argv,['opencode','--session','ses_abc123']);
  assert.equal(recovery({program:'opencode',verified:true,sessionId:'unsafe /path'}).state,'failed');
});
