import test from 'node:test';
import assert from 'node:assert/strict';
import {childRows} from '../mods/agents-order/harness-kids.js';
const row={id:'one',name:'review',model:'small',state:'review'};
test('两父进程隔离，状态由子项独立上报',()=>{const packet={version:1,pid:12,children:[row,row]}; assert.deepEqual(childRows(packet,13),[]);assert.deepEqual(childRows(packet,12),[row]);});
test('坏数据和未知协议不渲染',()=>{assert.deepEqual(childRows({version:2,pid:3,children:[row]},3),[]);assert.deepEqual(childRows(null,3),[]);});
