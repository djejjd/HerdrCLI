// 执行安装后的父方命令。fixture 替代 hc，记录标签写入并回喂给侧栏。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {childRows} from '../mods/agents-order/harness-kids.js';
import {visibleChildren} from '../mods/agents-order/sidebar-policy.js';

const command = fileURLToPath(new URL('../mods/agents-order/receive-child.py',import.meta.url));
const label = 'workbench.received.v1';
const published = 'workbench.children.v1';
const worker = (id,revision,extra={}) => ({id,name:id,state:'completed',revision,...extra});
const scope = 'a'.repeat(32);

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(),'herdr-receipt-fixture-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const address = 't' + dir.split('-').at(-1).toLowerCase();
  const state = join(dir,'state.json');
  const terminal = {address,created_ms:500,state:'live',foreground:{name:'fixture',pid:71},labels:{}};
  const snapshot = {version:1,pid:71,identity:scope,children:[worker('worker-a',10),worker('worker-b',20)]};
  writeFileSync(join(dir,'hc'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.HERDR_RECEIPT_FIXTURE;
const data = JSON.parse(fs.readFileSync(file,'utf8'));
const [sub,target,argument] = process.argv.slice(2);
if (target !== data.terminal.address) process.exit(2);
if (sub === 'get') {
  const response = data.gets >= 1 && data.secondTerminal ? data.secondTerminal : data.terminal;
  data.gets++;
  fs.writeFileSync(file,JSON.stringify(data));
  process.stdout.write(JSON.stringify(response));
} else if (sub === 'label') {
  if (data.failWrite) { process.stderr.write('private stderr'); process.exit(3); }
  const index = argument.indexOf('=');
  data.terminal.labels[argument.slice(0,index)] = argument.slice(index+1);
  data.writes++;
  fs.writeFileSync(file,JSON.stringify(data));
} else process.exit(2);
`,{mode:0o700});
  const read = () => JSON.parse(readFileSync(state,'utf8'));
  const prepare = (changed = {}, options = {}) => {
    const next = {...terminal, labels:{[published]:JSON.stringify({...snapshot,...changed})}};
    writeFileSync(state,JSON.stringify({terminal:next,gets:0,writes:0,...options}));
    return next;
  };
  prepare();
  const invoke = (...args) => spawnSync('python3',[command,...args],
    {encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,HC_TERMINAL_ID:address,HERDR_RECEIPT_FIXTURE:state}});
  const run = (child,rev,flags=['--temporary','--no-pending']) => invoke(child,String(rev),...flags);
  return {prepare,read,run,invoke,snapshot};
}

test('父方命令记录当前轮次，保留其他子项回执，侧栏据真实标签收起', t => {
  const fixture = setup(t);
  const listed = fixture.invoke('list');
  assert.equal(listed.status,0,listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout),[{id:'worker-a',revision:10},{id:'worker-b',revision:20}]);
  const first = fixture.run('worker-a',10);
  assert.equal(first.status,0,first.stderr);
  assert.equal(fixture.run('worker-b',20).status,0);
  assert.equal(fixture.run('worker-b',20).status,0);
  const {terminal,writes} = fixture.read();
  const receipt = JSON.parse(terminal.labels[label]);
  assert.deepEqual(receipt.received,{'worker-a':10,'worker-b':20});
  assert.equal(writes,2);
  const {snapshot} = fixture;
  const rows = childRows(snapshot,71);
  assert.deepEqual(visibleChildren(rows,terminal.labels[label],terminal,snapshot),[]);
  const rerun = {...snapshot,children:[worker('worker-a',11),worker('worker-b',20,{state:'working'})]};
  assert.equal(visibleChildren(childRows(rerun,71),terminal.labels[label],terminal,rerun).length,2);
  const newParent = {...snapshot,identity:'b'.repeat(32)};
  assert.deepEqual(visibleChildren(rows,terminal.labels[label],terminal,newParent),rows);
});

test('缺少确认、完成版本不符、交互、接管或恢复时不写标签', t => {
  const fixture = setup(t);
  for (const [item,rev,flags] of [
    [worker('worker-a',10),10,['--temporary']],
    [worker('worker-a',11),10,undefined],
    [worker('worker-a',10,{state:'working'}),10,undefined],
    [worker('worker-a',10,{lifecycle:{kind:'interactive'}}),10,undefined],
    [worker('worker-a',10,{lifecycle:{kind:'temporary',takeover:true}}),10,undefined],
    [worker('worker-a',10,{lifecycle:{kind:'temporary',recovering:true}}),10,undefined],
    [worker('worker-a',10,{lifecycle:{kind:'temporary',pending:true}}),10,undefined],
  ]) {
    fixture.prepare({children:[item]});
    assert.notEqual(fixture.run('worker-a',rev,flags).status,0);
    assert.equal(fixture.read().writes,0);
  }
});

test('父进程变化或写入失败时返回固定阶段，保留原标签', t => {
  const fixture = setup(t);
  const terminal = fixture.prepare();
  fixture.prepare({}, {secondTerminal:{...terminal,created_ms:501}});
  assert.notEqual(fixture.run('worker-a',10).status,0);
  assert.equal(fixture.read().writes,0);
  fixture.prepare({}, {failWrite:true});
  const refused = fixture.run('worker-a',10);
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/\bwrite\b/);
  assert.doesNotMatch(refused.stderr,/private stderr/);
  assert.equal(fixture.read().writes,0);
});
