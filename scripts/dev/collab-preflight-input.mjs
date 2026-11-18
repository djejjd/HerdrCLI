// 只读输入/证据辅助：大小、合法ID、同源路径、可读文件、派发回执。
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const MAX_BYTES = 256 * 1024;
export const MAX_ITEMS = 50;

export function canonical(path) {
  try { return realpathSync(path); } catch { return resolve(String(path ?? '')); }
}
export function sameSource(a, b) {
  return Boolean(a && b) && canonical(a) === canonical(b);
}
export function fileReadable(path) {
  try {
    if (typeof path !== 'string' || !path) return false;
    accessSync(path, constants.R_OK);
    return statSync(path).isFile();
  } catch { return false; }
}
export function validId(id) {
  return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(id);
}
export function readJson(path) {
  try {
    if (!fileReadable(path)) return null;
    if (statSync(path).size > MAX_BYTES) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return null; }
}
export function uniqueIds(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_ITEMS) return null;
  const ids = [];
  for (const item of list) {
    const id = item?.id;
    if (!validId(id) || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
}
export function countWithin(list, max = MAX_ITEMS) {
  return !list || (Array.isArray(list) && list.length <= max);
}
export function receiptValid(path, { taskId, implementer } = {}) {
  const receipt = readJson(path);
  if (!receipt || receipt.kind !== 'dispatch-receipt') return false;
  if (receipt.targetTaskId !== taskId || receipt.implementer !== implementer) return false;
  return receipt.result?.started === true && receipt.result?.status === 'done';
}
