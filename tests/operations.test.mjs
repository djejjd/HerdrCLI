// 启动的失败分支与返回值验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation } from '../mods/agent-workbench/operations.js';
test('启动失败不返回伪造终端',async()=>{
  await assert.rejects(createConversation(async()=>({code:1,stdout:'private error'}),{}),/launch/);
});
test('坏响应和缺少终端都有失败阶段',async()=>{
  for(const stdout of ['invalid','{}','{"error":"failed"}'])
    await assert.rejects(createConversation(async()=>({code:0,stdout}),{}),/response/);
});
test('启动仅传递任务元数据并返回确切终端',async()=>{
  const args={space:'sp1',name:'接口审查',folder:'/repo',argv:['codex']};
  const r=await createConversation(async(cmd,argv)=>{
    assert.equal(cmd,'herdr-app');assert.deepEqual(JSON.parse(argv[2]),args);
    return {code:0,stdout:'{"terminal":"t9"}'};
  },args);
  assert.equal(r.terminal,'t9');
});
test('关闭整个 Space 后以原机器目录重建 Space',async()=>{
  await createConversation(async(cmd,argv)=>{
    assert.equal(argv[1],'space.new');
    assert.deepEqual(JSON.parse(argv[2]),{name:'项目',tab:'接口审查',folder:'/repo',argv:['codex'],machine:null});
    return {code:0,stdout:'{"terminal":"t10"}'};
  },{space:'closed',spaceName:'项目',name:'接口审查',folder:'/repo',argv:['codex'],machine:null});
});
