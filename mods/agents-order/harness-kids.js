// 校验父终端身份，并在可重新核验父会话的读取失败后保留子项。
const states = new Set(['working','permission','reply','review','idle','completed','blocked','unknown']);
const failures = new Map([
  ['worker','子会话读取进程失败'], ['response','子会话读取响应无效'],
  ['process','父进程读取失败'],
  ['children','子会话关系读取失败'], ['label','子会话发布数据无效'],
]);

function validPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function validPacket(packet,pid) {
  return validPid(pid) && packet?.version === 1 && packet.pid === pid && Array.isArray(packet.children);
}

function terminalKey(term) {
  const pid = term?.foreground?.pid;
  if (typeof term?.address !== 'string' || !term.address || term.address.includes('/') || term.foreground?.name !== 'codex'
    || !validPid(pid) || !Number.isSafeInteger(term.created_ms) || term.created_ms <= 0) return null;
  return JSON.stringify([term.address,term.created_ms,pid]);
}

export function childReadTargets(terms) {
  return terms.filter(terminalKey).slice(0,16);
}

function failurePacket(pid, stage, extra = {}) {
  return {version:1,pid,stage,children:[],...extra};
}

// 只接受请求时和应答时均存在的终端。身份不明的失败包绝不借用旧父会话的数据。
export function updateChildPackets(previous, requested, current, result) {
  let batch = null;
  if (result?.code === 0) {
    try { batch = JSON.parse(result.stdout); } catch { /* 响应格式无效。 */ }
  }
  const defaultStage = result?.code === 0 ? 'response' : 'worker';
  const currentKeys = new Set(current.map(terminalKey));
  const next = new Map();
  for (const term of requested) {
    const key = terminalKey(term), pid = term.foreground.pid;
    if (!key || !currentKeys.has(key)) continue;
    const packet = batch?.[pid];
    if (!validPacket(packet,pid)) {
      next.set(key,failurePacket(pid,defaultStage));
      continue;
    }
    const {stage,identity} = packet;
    if (stage === 'process' || stage === 'identity') {
      next.set(key,failurePacket(pid,stage));
    } else if ((stage === 'ready' || stage === 'children') && typeof identity === 'string' && /^[a-f0-9]{32}$/.test(identity)) {
      const cached = previous?.get(key);
      const reusable = cached?.identity === identity ? cached.children : [];
      next.set(key,stage === 'ready' ? packet : failurePacket(pid,stage,{identity,children:reusable}));
    } else {
      next.set(key,failurePacket(pid,'response'));
    }
  }
  return next;
}

export function childPacketFor(term, packets, useLabel = true) {
  const native = packets?.get(terminalKey(term)) ?? null;
  const label = useLabel && term?.labels?.['workbench.children.v1'];
  const pid = term?.foreground?.pid;
  if (typeof label !== 'string') return native;
  if (label.length <= 8192) {
    try {
      const packet = JSON.parse(label);
      if (validPacket(packet,pid)) return packet;
    } catch { /* 继续使用已核验的本机读数。 */ }
  }
  return native ?? failurePacket(pid,'label');
}

// 失败状态以固定文案呈现。已保存的子项只继续提供身份展示，状态降级为未知。
export function childRows(packet,pid) {
  if (!validPacket(packet,pid) || packet.stage === 'identity') return [];
  const reading = failures.get(packet.stage);
  const seen = new Set(), rows = [];
  const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80) : '';
  for (const item of packet.children.slice(0,16)) {
    const id = clean(item?.id), name = clean(item?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const row = {id,name,model:clean(item.model),state:!reading && states.has(item.state) ? item.state : 'unknown'};
    if (reading) row.reading = reading;
    if (Array.isArray(item.events)) row.events = item.events.slice(-8).map(clean);
    if (Number.isSafeInteger(item.revision)) row.revision = item.revision;
    rows.push(row);
  }
  if (reading && !rows.length) rows.push({id:null,name:reading,model:'',state:'unknown'});
  return rows;
}
