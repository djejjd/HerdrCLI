import test from 'node:test';
import assert from 'node:assert/strict';
import {toggleWidth,statusText} from '../mods/agents-order/sidebar-policy.js';
test('折叠和恢复支持保存宽度和旧的过窄记录',()=>{assert.deepEqual(toggleWidth(330,0,76),{min:76,px:76});assert.deepEqual(toggleWidth(76,330,76),{min:240,px:330});assert.equal(toggleWidth(76,60,76).px,240);});
test('状态提示只含状态',()=>{assert.equal(statusText('permission'),'待授权');assert.equal(statusText('completed'),'本轮已完成');assert.equal(statusText('other'),'状态未知');});

test('交件收妥只收起同一轮已完成的指定子项', async()=>{const {visibleChildren}=await import('../mods/agents-order/sidebar-policy.js');const kid={id:'x',state:'completed',revision:12};assert.deepEqual(visibleChildren([kid],'{"x":12}'),[]);for(const changed of [{state:'working'},{revision:13}])assert.equal(visibleChildren([{...kid,...changed}],'{"x":12}').length,1);});
