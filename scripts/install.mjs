// 部署仓库内个人 mod，并从已核实布局派生工作台布局。
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { patchLayout } from './notify-layout.mjs';
const target=resolve(homedir(),'.config/herdr-app');
const base=JSON.parse(await readFile(resolve(target,'layouts/verified-main.json'),'utf8'));
for(const name of ['agent-workbench','workbench-pane','workbench-tabs','workbench-menu','workspace-chrome','notify','notify-toast']) {
  await mkdir(resolve(target,'mods',name),{recursive:true});
  await cp(resolve('mods',name),resolve(target,'mods',name),{recursive:true});
}
function update(node) {
  if(node.content?.mod==='verified-tabs')node.content.mod='workbench-tabs';
  if(node.content?.mod==='agents')node.content.mod='agent-workbench';
  if(node.content?.pane?.header)node.content.pane.header={content:{mod:'workbench-pane'},height:28,position:'top',reveal:'hover'};
  for(const child of node.children??[])update(child);
}
update(base);
// 合并导航：去掉独立 Spaces 块，工作台占满侧栏剩余高度。
function dropSpaces(node) {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.filter(c => c.content?.mod !== 'spaces');
  node.children.forEach(dropSpaces);
}
dropSpaces(base);
// 侧栏内容可读下限 240：手动拖不窄于 240。折叠改为整块隐藏（layout.toggle），
// 不再缩成 76 窄条，所以这里不会被折叠宽度夹住。
function findNode(node,id) {
  if(node?.id===id) return node;
  for(const child of node?.children??[]) { const hit=findNode(child,id); if(hit) return hit; }
  return null;
}
const sidebar=findNode(base,'sidebar');
if(!sidebar) throw new Error('agent-workbench: sidebar 不存在，拒绝写入不完整布局');
sidebar.min=240;
// 通知：toast 换成 notify-toast，并把 notify-float 固定到右下角；重复执行不会叠加。
const withNotify=patchLayout(base);
await writeFile(resolve(target,'layouts/agent-workbench.json'),JSON.stringify(withNotify,null,2)+'\n');
console.log('已部署 agent-workbench、workbench-pane 和工作台布局');
