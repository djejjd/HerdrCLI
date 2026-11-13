// 两个窗口并发操作时只允许一个启动，释放后允许重试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
test('原子锁阻止双启动并在终态释放',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'herdr-lock-'));
  const invoke=(action)=>exec(process.execPath,['mods/agent-workbench/lock.mjs',action,'record'],{env:{...process.env,HERDR_WORKBENCH_LOCK_HOME:dir}});
  try {
    const results=await Promise.allSettled([invoke('acquire'),invoke('acquire')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    await invoke('release');await invoke('acquire');await invoke('release');
  }finally{await rm(dir,{recursive:true,force:true});}
});
