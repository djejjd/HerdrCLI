import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaSelection, quotaLines } from '../mods/magpie-status/model.js';

test('额度跟随已确认路由，多个账号且归属未知时不显示任一账号额度', () => {
  const cards = [{provider:'codex',user:'a'}, {provider:'codex',user:'b'}, {provider:'deepseek'}];
  assert.equal(quotaSelection(cards, 'codex', null).current, null);
  assert.equal(quotaSelection(cards, 'codex', 'b').current, cards[1]);
  assert.equal(quotaSelection(cards, 'codex', 'other').current, null);
  assert.deepEqual(quotaSelection(cards, null, null).others, cards);
});

test('保留零额度并拒绝无效窗口', () => {
  assert.deepEqual(quotaLines({windows:[{name:'5h',remaining:0},{name:'week',remaining:null}]}), ['5h 剩 0%']);
});
