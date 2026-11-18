// 只读交付前检查：原需求与交付分离，严格字段/ID/大小，覆盖/派发/首响应/资源/证据边界。
// 不写文件、不 kill、不读正文；错误只输出规则、合法ID、阶段。
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  canonical, sameSource, fileReadable, validId, readJson,
  uniqueIds, countWithin, receiptValid,
} from './collab-preflight-input.mjs';

const LSOF = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';

function fail(rule, id, stage, code = 1) {
  const out = { ok: false, rule, stage };
  if (id && validId(id)) out.id = id;
  console.log(JSON.stringify(out));
  process.exit(code);
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--request') out.request = argv[++i];
    else if (argv[i] === '--delivery') out.delivery = argv[++i];
  }
  return out;
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}
function identityObserved(pid, path) {
  if (!path) return false;
  try {
    const out = execFileSync(LSOF, ['-Fn', '-p', String(pid)], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 });
    const target = canonical(path);
    return out.split('\n').filter(l => l.startsWith('n'))
      .some(l => canonical(l.slice(1)) === target);
  } catch { return false; }
}

function validateRequest(req) {
  if (!req || !validId(req.taskId)) fail('INPUT', null, 'request', 2);
  const ids = uniqueIds(req.requirements);
  if (!ids) fail('INPUT', null, 'request-ids', 2);
  return { taskId: req.taskId, ids };
}

function checkShape(delivery) {
  if (!delivery || typeof delivery !== 'object') fail('INPUT', null, 'delivery', 2);
  if (!Array.isArray(delivery.coverage) || !countWithin(delivery.coverage)) fail('INPUT', null, 'coverage-shape', 2);
  if (!delivery.scope || typeof delivery.scope.approved !== 'boolean') fail('INPUT', null, 'scope-shape', 2);
  if (!delivery.dispatch || typeof delivery.dispatch.planApproved !== 'boolean') fail('INPUT', null, 'dispatch-shape', 2);
  if (!delivery.runner || typeof delivery.runner !== 'object') fail('INPUT', null, 'runner-shape', 2);
  if (!delivery.ui || typeof delivery.ui.delivered !== 'boolean') fail('INPUT', null, 'ui-shape', 2);
  if (!Array.isArray(delivery.resources) || !countWithin(delivery.resources)) fail('INPUT', null, 'resources-shape', 2);
}

function checkScope(scope, missing, original) {
  if (!missing.length) return;
  if (!scope.approved) fail('REQ-COVERAGE', missing[0], 'coverage');
  if (scope.decision?.by !== 'user' || !fileReadable(scope.decision?.path)) fail('SCOPE-DECISION', null, 'decision');
  if (!Array.isArray(scope.removed) || !scope.removed.every(id => original.includes(id))) fail('SCOPE-DECISION', null, 'removed');
  const removed = new Set(scope.removed);
  const unexplained = missing.filter(id => !removed.has(id));
  if (unexplained.length) fail('REQ-COVERAGE', unexplained[0], 'coverage');
}

function checkCoverage(delivery, reqIds) {
  const coverage = delivery.coverage;
  const ids = [];
  for (const row of coverage) {
    if (!validId(row?.id)) fail('INPUT', null, 'coverage-id', 2);
    if (ids.includes(row.id)) fail('INPUT', row.id, 'coverage-duplicate', 2);
    ids.push(row.id);
  }
  const unknown = ids.find(id => !reqIds.includes(id));
  if (unknown) fail('COVERAGE-ID', unknown, 'unknown');
  checkScope(delivery.scope, reqIds.filter(id => !ids.includes(id)), reqIds);
  for (const row of coverage) if (!fileReadable(row.evidence)) fail('REQ-EVIDENCE', row.id, 'evidence');
}

function checkDispatch(delivery, taskId) {
  const d = delivery.dispatch;
  if (!d.planApproved) return;
  if (!validId(d.implementer) || typeof d.nextAction !== 'string' || !d.nextAction.trim()) {
    fail('DISPATCH', null, 'implementer-or-next');
  }
  if (!receiptValid(d.receipt, { taskId, implementer: d.implementer })) {
    fail('DISPATCH-RECEIPT', null, 'receipt');
  }
}

function checkRunner(runner) {
  const first = runner.firstResponse;
  if (!first || first.kind !== 'model-response' || !fileReadable(first.path)) {
    fail('RUNNER-FIRST-RESPONSE', null, 'first-response');
  }
}

function checkUi(delivery) {
  const ui = delivery.ui;
  if (!ui.delivered) return { unverified: [], realClick: false };
  if (!['fixture', 'real-render', 'real-click'].includes(ui.scope)) fail('UI-EVIDENCE', null, 'scope');
  const realClick = ui.scope === 'real-click' && ui.interaction?.kind === 'real-click' && fileReadable(ui.interaction?.path);
  if (ui.scope === 'real-click' && !realClick) fail('UI-EVIDENCE', null, 'real-click');
  if (ui.claim === 'full-acceptance' && !realClick) fail('UI-EVIDENCE', null, 'acceptance-without-click');
  return { unverified: realClick ? [] : ['interaction'], realClick };
}

function checkResources(delivery, taskId) {
  for (const r of delivery.resources) {
    if (!validId(r?.id)) fail('INPUT', null, 'resource-id', 2);
    if (!validId(r.ownerTask)) fail('INPUT', null, 'resource-owner', 2);
    if (r.ownerTask !== taskId) continue;
    const pid = Number(r.pid);
    if (!Number.isInteger(pid) || pid <= 0) fail('RESOURCE-STATE', r.id, 'pid');
    if (!['running', 'exited'].includes(r.state)) fail('RESOURCE-STATE', r.id, 'state');
    if (r.state === 'exited') {
      if (!fileReadable(r.exitEvidence)) fail('RESOURCE-EXIT', r.id, 'exit-evidence');
      if (!alive(pid)) continue;
      if (!identityObserved(pid, r.identityPath)) fail('RESOURCE-OWNERSHIP', r.id, 'identity');
      fail('RESOURCE-EXIT', r.id, 'exited-but-live');
    }
    if (!alive(pid)) fail('RESOURCE-STATE', r.id, 'not-live');
    if (!identityObserved(pid, r.identityPath)) fail('RESOURCE-OWNERSHIP', r.id, 'identity');
    fail('RESOURCE-EXIT', r.id, 'live');
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.request || !args.delivery) fail('INPUT', null, 'args', 2);
if (sameSource(args.request, args.delivery)) fail('INPUT', null, 'same-source', 2);
const req = readJson(args.request);
const delivery = readJson(args.delivery);
const request = validateRequest(req);
if (!delivery || delivery.taskId !== request.taskId) fail('INPUT', null, 'task-id', 2);
checkShape(delivery);
checkCoverage(delivery, request.ids);
checkDispatch(delivery, request.taskId);
checkRunner(delivery.runner);
const ui = checkUi(delivery);
checkResources(delivery, request.taskId);
console.log(JSON.stringify({
  ok: true,
  status: ui.realClick ? 'pass' : 'technical-pass',
  taskId: request.taskId,
  unverified: ui.unverified,
}));
process.exit(0);
