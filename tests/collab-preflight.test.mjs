import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const SCRIPT = new URL('../scripts/dev/collab-preflight.mjs', import.meta.url).pathname;

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'collab-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function evidence(dir, name) {
  const path = join(dir, name);
  writeFileSync(path, 'evidence');
  return path;
}

function receipt(dir, overrides = {}) {
  const path = join(dir, 'dispatch-receipt.json');
  writeFileSync(path, JSON.stringify({
    kind: 'dispatch-receipt', targetTaskId: 'T1', implementer: 't31',
    result: { started: true, status: 'done', turn: 13 }, ...overrides,
  }));
  return path;
}

function request(dir, ids = ['R-01', 'R-02', 'R-03']) {
  const path = join(dir, 'request.json');
  writeFileSync(path, JSON.stringify({ taskId: 'T1', requirements: ids.map(id => ({ id })) }));
  return path;
}

function delivery(dir, overrides = {}) {
  const base = {
    taskId: 'T1',
    coverage: [
      { id: 'R-01', evidence: evidence(dir, 'r1.txt') },
      { id: 'R-02', evidence: evidence(dir, 'r2.txt') },
      { id: 'R-03', evidence: evidence(dir, 'r3.txt') },
    ],
    scope: { approved: false },
    dispatch: { planApproved: true, implementer: 't31', nextAction: 'implement', receipt: receipt(dir) },
    runner: { listed: ['model-a'], firstResponse: { kind: 'model-response', path: evidence(dir, 'first.txt'), at: '2026-11-17T20:00:00+08:00' } },
    ui: { delivered: true, scope: 'fixture', claim: 'technical' },
    resources: [],
    ...overrides,
  };
  const path = join(dir, 'delivery.json');
  writeFileSync(path, JSON.stringify(base));
  return path;
}

function run(requestPath, deliveryPath) {
  const r = spawnSync(process.execPath, [SCRIPT, '--request', requestPath, '--delivery', deliveryPath], { encoding: 'utf8' });
  let out = null;
  try { out = JSON.parse(r.stdout.trim()); } catch { out = null; }
  return { code: r.status, out, stderr: r.stderr };
}

function liveProcess(identityPath) {
  return spawn(process.execPath, ['-e', `
    const fs = require('fs');
    fs.openSync(process.argv[1], 'r');
    setInterval(() => {}, 1000);
  `, identityPath], { stdio: 'ignore' });
}

test('complete technical delivery passes but marks interaction unverified', (t) => {
  const dir = workspace(t);
  const r = run(request(dir), delivery(dir));
  assert.equal(r.code, 0);
  assert.equal(r.out.ok, true);
  assert.equal(r.out.status, 'technical-pass');
  assert.deepEqual(r.out.unverified, ['interaction']);
});

test('missing original requirement is rejected even when testsPassed', (t) => {
  const dir = workspace(t);
  const d = requireText(delivery(dir, {
    coverage: [
      { id: 'R-01', evidence: evidence(dir, 'r1.txt') },
      { id: 'R-02', evidence: evidence(dir, 'r2.txt') },
    ],
  }));
  d.testsPassed = true;
  writeFileSync(join(dir, 'delivery.json'), JSON.stringify(d));
  const r = run(request(dir), join(dir, 'delivery.json'));
  assert.equal(r.code, 1);
  assert.equal(r.out.rule, 'REQ-COVERAGE');
  assert.equal(r.out.id, 'R-03');
});

test('scope reduction needs an explicit user decision and only removes named ids', (t) => {
  const dir = workspace(t);
  const noDecision = delivery(dir, {
    coverage: [{ id: 'R-01', evidence: evidence(dir, 'r1.txt') }],
    scope: { approved: true },
  });
  assert.equal(run(request(dir), noDecision).out.rule, 'SCOPE-DECISION');

  const decision = evidence(dir, 'user-decision.txt');
  const exact = delivery(dir, {
    coverage: [{ id: 'R-01', evidence: evidence(dir, 'r1.txt') }],
    scope: { approved: true, decision: { by: 'user', path: decision }, removed: ['R-02', 'R-03'] },
  });
  assert.equal(run(request(dir), exact).code, 0);
});

test('approved plan without implementer/next delivery is rejected', (t) => {
  const dir = workspace(t);
  const r = run(request(dir), delivery(dir, { dispatch: { planApproved: true } }));
  assert.equal(r.code, 1);
  assert.equal(r.out.rule, 'DISPATCH');
});

test('model-list-only is not a first response', (t) => {
  const dir = workspace(t);
  const r = run(request(dir), delivery(dir, { runner: { listed: ['model-a'] } }));
  assert.equal(r.code, 1);
  assert.equal(r.out.rule, 'RUNNER-FIRST-RESPONSE');
});

test('real UI claim without real-click evidence is rejected; fixture passes with boundary', (t) => {
  const dir = workspace(t);
  const fake = run(request(dir), delivery(dir, {
    ui: { delivered: true, scope: 'real-render', claim: 'full-acceptance' },
  }));
  assert.equal(fake.code, 1);
  assert.equal(fake.out.rule, 'UI-EVIDENCE');

  const fixture = run(request(dir), delivery(dir, { ui: { delivered: true, scope: 'fixture', claim: 'technical' } }));
  assert.equal(fixture.code, 0);
  assert.deepEqual(fixture.out.unverified, ['interaction']);

  const clicked = run(request(dir), delivery(dir, {
    ui: { delivered: true, scope: 'real-click', claim: 'full-acceptance', interaction: { kind: 'real-click', path: evidence(dir, 'click.txt') } },
  }));
  assert.equal(clicked.code, 0);
  assert.deepEqual(clicked.out.unverified, []);
});

test('live owned test process is rejected by real read-only identity check', async (t) => {
  const dir = workspace(t);
  const identity = join(dir, 'identity.sock');
  writeFileSync(identity, 'x');
  const child = liveProcess(identity);
  t.after(async () => { child.kill(); await once(child, 'exit'); });
  await new Promise(r => setTimeout(r, 100));
  const r = run(request(dir), delivery(dir, {
    resources: [{ id: 'P-1', ownerTask: 'T1', pid: child.pid, identityPath: identity, state: 'running' }],
  }));
  assert.equal(r.code, 1);
  assert.equal(r.out.rule, 'RESOURCE-EXIT');
});

test('claimed exited but still live is rejected; dead with exit evidence passes', async (t) => {
  const dir = workspace(t);
  const identity = join(dir, 'identity.sock');
  writeFileSync(identity, 'x');
  const child = liveProcess(identity);
  t.after(async () => { child.kill(); await once(child, 'exit'); });
  await new Promise(r => setTimeout(r, 100));
  const liveClaim = run(request(dir), delivery(dir, {
    resources: [{ id: 'P-1', ownerTask: 'T1', pid: child.pid, identityPath: identity, state: 'exited', exitEvidence: evidence(dir, 'exit.txt') }],
  }));
  assert.equal(liveClaim.code, 1);
  assert.equal(liveClaim.out.rule, 'RESOURCE-EXIT');

  const dead = run(request(dir), delivery(dir, {
    resources: [{ id: 'P-2', ownerTask: 'T1', pid: 999999, state: 'exited', exitEvidence: evidence(dir, 'exit2.txt') }],
  }));
  assert.equal(dead.code, 0);
});

test('live pid without observable identity is needs-verify, never auto-kill', async (t) => {
  const dir = workspace(t);
  const held = join(dir, 'held.sock');
  writeFileSync(held, 'x');
  const child = liveProcess(held);
  t.after(async () => { child.kill(); await once(child, 'exit'); });
  await new Promise(r => setTimeout(r, 100));
  const r = run(request(dir), delivery(dir, {
    resources: [{ id: 'P-1', ownerTask: 'T1', pid: child.pid, identityPath: join(dir, 'different.sock'), state: 'running' }],
  }));
  assert.equal(r.code, 1);
  assert.equal(r.out.rule, 'RESOURCE-OWNERSHIP');
});

test('missing request/delivery input exits 2 without echoing paths', (t) => {
  const dir = workspace(t);
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout, /\/tmp|collab-preflight/);
});


test('same request/delivery path and symlink are rejected as input error', (t) => {
  const dir = workspace(t);
  const req = request(dir);
  const same = run(req, req);
  assert.equal(same.code, 2);
  assert.equal(same.out.stage, 'same-source');

  const link = join(dir, 'delivery-link.json');
  symlinkSync(req, link);
  const linked = run(req, link);
  assert.equal(linked.code, 2);
  assert.equal(linked.out.stage, 'same-source');
});

test('missing required delivery fields cannot default to pass', (t) => {
  const dir = workspace(t);
  for (const field of ['coverage', 'scope', 'dispatch', 'runner', 'ui', 'resources']) {
    const d = requireText(delivery(dir));
    delete d[field];
    const path = join(dir, `missing-${field}.json`);
    writeFileSync(path, JSON.stringify(d));
    const r = run(request(dir), path);
    assert.equal(r.code, 2, field);
    assert.equal(r.out.rule, 'INPUT', field);
  }
});

test('approval file cannot masquerade as a dispatch receipt', (t) => {
  const dir = workspace(t);
  const r = run(request(dir), delivery(dir, {
    dispatch: { planApproved: true, implementer: 't31', nextAction: 'implement', receipt: evidence(dir, 'approved.md') },
  }));
  assert.equal(r.code, 1);
  assert.equal(r.out.rule, 'DISPATCH-RECEIPT');
});

test('illegal ids and over-limit requests are rejected, not filtered', (t) => {
  const dir = workspace(t);
  const bad = join(dir, 'bad-request.json');
  writeFileSync(bad, JSON.stringify({ taskId: 'T1', requirements: [{ id: 'R-01' }, { id: 'bad id!' }] }));
  assert.equal(run(bad, delivery(dir)).code, 2);

  const tooMany = join(dir, 'many-request.json');
  writeFileSync(tooMany, JSON.stringify({ taskId: 'T1', requirements: Array.from({ length: 51 }, (_, i) => ({ id: `R-${i + 1}` })) }));
  const r = run(tooMany, delivery(dir));
  assert.equal(r.code, 2);
  assert.equal(r.out.rule, 'INPUT');
});


test('resource ownerTask missing/invalid is rejected; other-task resources are skipped', async (t) => {
  const dir = workspace(t);
  const missingOwner = run(request(dir), delivery(dir, {
    resources: [{ id: 'P-1', pid: 999999, state: 'exited', exitEvidence: evidence(dir, 'exit.txt') }],
  }));
  assert.equal(missingOwner.code, 2);
  assert.equal(missingOwner.out.stage, 'resource-owner');

  const identity = join(dir, 'other-identity.sock');
  writeFileSync(identity, 'x');
  const child = liveProcess(identity);
  t.after(async () => { child.kill(); await once(child, 'exit'); });
  await new Promise(r => setTimeout(r, 100));
  const other = run(request(dir), delivery(dir, {
    resources: [{ id: 'P-2', ownerTask: 'T2', pid: child.pid, identityPath: identity, state: 'running' }],
  }));
  assert.equal(other.code, 0); // 明确属于其他任务：不检查、不 kill
});

function requireText(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
