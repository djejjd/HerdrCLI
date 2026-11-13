// Codex 费用入口必须可执行：缺 sessionId 时应返回 unknown，而不是运行时 ReferenceError。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'mods', 'agent-workbench', 'usage.mjs');

test('codex 缺 sessionId 返回 unknown 而不是 codexCost 未定义', () => {
  const out = execFileSync(process.execPath, [cli, 'codex', '1'], { encoding:'utf8', timeout:5000 });
  const d = JSON.parse(out);
  assert.equal(d.status, 'unknown');
  assert.match(d.reason ?? '', /会话 ID/);
  assert.ok(!String(out).includes('codexCost'));
});
