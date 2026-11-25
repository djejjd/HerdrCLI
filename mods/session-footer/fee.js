// 逐条解析 Magpie CSV，支持引号、嵌入换行及双引号转义。
function* csvRecords(text) {
  let fields = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') { fields.push(field); field = ''; }
    else if (!quoted && c === '\n') { yield [...fields, field.trimEnd()]; fields = []; field = ''; }
    else field += c;
  }
  if (!quoted && (fields.length || field)) yield [...fields,field];
}

// 只累计同一会话、同一实际模型的成功请求。缺失金额时省略整项。
export function sessionCost(text, session, model) {
  if (!session || !model) return null;
  const records = csvRecords(text);
  const header = records.next().value ?? [];
  const index = Object.fromEntries(header.map((name,i) => [name,i]));
  let sum = 0, count = 0;
  for (const row of records) {
    if (row[index.session] !== session || (row[index.served_model] || row[index.model]) !== model) continue;
    if (!/^2\d\d$/.test(row[index.status])) continue;
    const amount = row[index.cost_usd];
    if (!amount?.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0) return null;
    sum += Number(amount); count++;
  }
  return count ? sum : null;
}

export function showFooter(address, agents, program) {
  return !!address && (agents.some(agent => agent.address === address) || /^(codex|claude|omp|opencode|dsh-tui)$/i.test(program ?? ''));
}

export function familyCost(text,root,children) {
  const groups = new Map([[root,{name:'主对话',amount:null,pending:0}]]);
  for (const {id,name} of children) if (id && !groups.has(id)) groups.set(id,{name,amount:null,pending:0});
  const records = csvRecords(text);
  const header = records.next().value ?? [];
  const index = Object.fromEntries(header.map((name,position) => [name,position]));
  const requests = new Map();
  for (const row of records) {
    const session = row[index.session];
    if (!groups.has(session) || !/^2\d\d$/.test(row[index.status])) continue;
    const raw = row[index.cost_usd]?.trim();
    const amount = raw && Number.isFinite(Number(raw)) && Number(raw)>=0 ? Number(raw) : null;
    const key = row[index.request_id] || row[index.response_id] || Symbol();
    const prior = requests.get(key);
    requests.set(key,{session:prior?.session === root ? root : session,amount:amount ?? prior?.amount ?? null});
  }
  let total = null, pending = 0;
  for (const {session,amount} of requests.values()) {
    const group = groups.get(session);
    if (amount === null) { group.pending++; pending++; }
    else { group.amount = (group.amount ?? 0) + amount; total = (total ?? 0) + amount; }
  }
  return {amount:total,pending,main:groups.get(root),children:[...groups.values()].slice(1)};
}

export function latestBillingKey(text,session) {
  const records=csvRecords(text);
  const header=records.next().value ?? [];
  const index=Object.fromEntries(header.map((field,position)=>[field,position]));
  let latest=-Infinity, result=null;
  for (const row of records) {
    if (row[index.session]!==session || !/^2\d\d$/.test(row[index.status])) continue;
    const time=Date.parse(row[index.time]);
    if (!Number.isFinite(time) || time<latest) continue;
    latest=time;
    const id=row[index.provider_key_id];
    result=/^[a-f0-9]{10}$/i.test(id) ? {provider:row[index.provider],id} : null;
  }
  return result;
}
