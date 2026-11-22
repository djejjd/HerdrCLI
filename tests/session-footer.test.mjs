import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionCost, showFooter } from '../mods/session-footer/fee.js';
const rows='session,served_model,model,cost_usd,status\na,gpt,gpt,0.12,200\nb,gpt,gpt,9,200\na,other,gpt,7,200\na,gpt,gpt,0.18,200\n';
test('按会话与实际模型汇总费用',()=>assert.equal(sessionCost(rows,'a','gpt'),0.30));
test('缺失费用或归属时省略金额',()=>{assert.equal(sessionCost(rows,'unknown','gpt'),null); assert.equal(sessionCost(rows+'a,gpt,gpt,,200\n','a','gpt'),null);});
test('切回 Shell 收起底栏',()=>{assert.equal(showFooter('t2',[{address:'t1'}],'zsh'),false); assert.equal(showFooter('t1',[{address:'t1'}],'codex'),true);});
