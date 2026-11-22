import test from 'node:test';
import assert from 'node:assert/strict';
import {toggleWidth,statusText,visibleChildren} from '../mods/agents-order/sidebar-policy.js';
test('折叠和恢复支持保存宽度和旧的过窄记录',()=>{assert.deepEqual(toggleWidth(330,0,76),{min:76,px:76});assert.deepEqual(toggleWidth(76,330,76),{min:240,px:330});assert.equal(toggleWidth(76,60,76).px,240);});
test('状态提示只含状态',()=>{assert.equal(statusText('permission'),'待授权');assert.equal(statusText('completed'),'本轮已完成');assert.equal(statusText('other'),'状态未知');});

test('无父身份作用域的旧回执和进入接管的回执都保持可见', () => {
  const kid = {id:'x',state:'completed',revision:12};
  const terminal = {address:'t1',created_ms:10,foreground:{pid:12}};
  const snapshot = {pid:12,identity:'session',children:[{...kid,lifecycle:{kind:'temporary',takeover:true}}]};
  const receipt = {
    version:1,parent:{address:'t1',createdMs:10,pid:12,identity:'session'},received:{x:12},
  };
  assert.deepEqual(visibleChildren([kid],'{"x":12}',terminal,snapshot),[kid]);
  assert.deepEqual(visibleChildren([kid],JSON.stringify(receipt),terminal,snapshot),[kid]);
});
