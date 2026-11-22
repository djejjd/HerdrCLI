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
