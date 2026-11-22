// 校验父终端进程与协议版本，再取最多 16 条用于展示的元数据。
export function childRows(packet,pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || packet?.version !== 1 || packet.pid !== pid || !Array.isArray(packet.children)) return [];
  const seen = new Set(), rows = [];
  const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80) : '';
  for (const item of packet.children.slice(0,16)) {
    const id = clean(item?.id), name = clean(item?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    rows.push({id,name,model:clean(item.model),state:['working','permission','reply','review','idle','completed','blocked','unknown'].includes(item.state) ? item.state : 'unknown'});
  }
  return rows;
}
