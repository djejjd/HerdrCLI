// 只给 agent-workbench layout 加 notify-toast 与右下角 notify-float。
// 先备份 layout + shared.json；--check 不写，--apply 原子写，--rollback 恢复最近备份。
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_HOME = resolve(process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'));
const LAYOUT = join(APP_HOME, 'layouts/agent-workbench.json');
const SHARED = join(APP_HOME, 'shared.json');
const FLOAT = {
  id: 'notify-float',
  content: { mod: 'notify' },
  edge: 'right',
  align: 'end',
  background: 'chrome',
};

export function patchLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new Error('layout 必须是 JSON 对象');
  }
  if (layout.toast && !['notify-toast', 'pending-toast'].includes(layout.toast)) {
    throw new Error(`layout toast 已是 ${layout.toast}，拒绝覆盖`);
  }
  if (layout.floating !== undefined && !Array.isArray(layout.floating)) {
    throw new Error('layout floating 必须是数组');
  }
  const next = JSON.parse(JSON.stringify(layout));
  next.toast = 'notify-toast';
  const floats = (next.floating ?? []).filter(f => f && typeof f === 'object'
    && !['pending-float', 'pending-side', 'notify-float'].includes(f.id));
  floats.push({ ...FLOAT, content: { ...FLOAT.content } });
  next.floating = floats;
  return next;
}

function stamp() {
  return `${Date.now()}-${process.pid}`;
}

async function readLayout() {
  return JSON.parse(await readFile(LAYOUT, 'utf8'));
}

async function backup() {
  const dir = join(APP_HOME, `.backup-notify-${stamp()}`);
  await mkdir(dir, { recursive: true });
  await copyFile(LAYOUT, join(dir, 'agent-workbench.json'));
  if (existsSync(SHARED)) await copyFile(SHARED, join(dir, 'shared.json'));
  return dir;
}

async function writeLayout(layout) {
  const text = `${JSON.stringify(layout, null, 2)}\n`;
  const tmp = `${LAYOUT}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, LAYOUT);
}

function summary(before, after) {
  return [
    `toast: ${before.toast ?? '(none)'} -> ${after.toast}`,
    `floating: ${(before.floating ?? []).map(f => f?.id ?? '?').join(',') || '(none)'} -> ${after.floating.map(f => f.id).join(',')}`,
  ].join('\n');
}

async function check() {
  const before = await readLayout();
  const after = patchLayout(before);
  console.log(summary(before, after));
  console.log('check ok（未写文件）');
}

async function apply() {
  const before = await readLayout();
  const after = patchLayout(before);
  const dir = await backup();
  await writeLayout(after);
  console.log(summary(before, after));
  console.log(`backup: ${dir}`);
  console.log('apply ok');
}

async function rollback() {
  const names = (await readdir(APP_HOME, { withFileTypes: true }))
    .filter(d => d.isDirectory() && d.name.startsWith('.backup-notify-'))
    .map(d => d.name)
    .sort();
  if (!names.length) throw new Error('没有 .backup-notify-* 备份');
  const dir = join(APP_HOME, names[names.length - 1]);
  const restored = JSON.parse(await readFile(join(dir, 'agent-workbench.json'), 'utf8'));
  await writeLayout(restored);
  console.log(`restored: ${dir}`);
}

async function main(argv) {
  const cmd = argv[2] ?? '--check';
  if (cmd === '--check') return check();
  if (cmd === '--apply') return apply();
  if (cmd === '--rollback') return rollback();
  console.log('用法: node scripts/notify-layout.mjs [--check|--apply|--rollback]');
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main(process.argv).catch((err) => {
    console.error(`notify-layout: ${err.message}`);
    process.exit(1);
  });
}
