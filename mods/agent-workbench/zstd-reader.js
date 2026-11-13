// zstd 解压：无 shell 拼接、硬限额、超时/超限 kill，单次 settle；可注入 spawn 便于测试。
export function readZstd(path, { spawn, caps = {}, now = Date.now } = {}) {
  const maxBytes = caps.maxBytes ?? 32 * 1024 * 1024;
  const maxRecords = caps.maxRecords ?? 50000;
  const timeoutMs = caps.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    if (typeof spawn !== 'function') { resolve({ text:'', truncated:false, records:0, reason:'缺少 spawn' }); return; }
    let child;
    try { child = spawn('zstd', ['-dc', path], { stdio:['ignore','pipe','ignore'] }); }
    catch (err) { resolve({ text:'', truncated:false, records:0, reason:String(err?.message ?? err) }); return; }
    let text = '', bytes = 0, records = 0, truncated = false, settled = false, reason = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text, truncated, records, reason });
    };
    const kill = () => { try { child.kill?.('SIGKILL'); } catch {} };
    const timer = setTimeout(() => { truncated = true; reason = 'timeout'; kill(); finish(); }, timeoutMs);
    child.stdout?.on?.('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) { truncated = true; reason = 'bytes'; kill(); finish(); return; }
      const piece = chunk.toString('utf8');
      text += piece;
      records += (piece.match(/\n/g) || []).length;
      if (records > maxRecords) { truncated = true; reason = 'records'; kill(); finish(); }
    });
    child.on?.('close', () => { if (!reason) reason = null; finish(); });
    child.on?.('error', (err) => { reason = String(err?.message ?? err); finish(); });
  });
}
