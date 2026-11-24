// 通过真实松手入口验证混合侧栏排序，宿主只模拟快照和标签写入。
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
const mock = `
export class View {}
export const div=0,image=0,svg=0,h_flex=0,v_flex=0,ScrollHandle=0,InputState=0,Input=0;
export const machines=0,focused=0,run=0,theme=0,settings=0,shared=0,setShared=0,setAgentOrder=0,openOverlay=0,closeOverlay=0,window=0,layout=0,checking=0,home=0,appHome=0,readTextFile=0,exec=0,notify=0;
export const agents=()=>[{address:'a',space:'s'}],props=()=>({tree:true});
export const spaces=()=>[{id:'s',tabs:[{id:'tab'}]}],panes=()=>[{terminal:'b',tab:'tab'}];
export const terminals=()=>globalThis.dropTerminals;
export const hc=async ([,address,label])=>{terminals().find(t=>t.address===address).labels['workbench.order']=label.split('=')[1];return {code:0}};
`;
const url='data:text/javascript,'+encodeURIComponent(mock);
register('data:text/javascript,'+encodeURIComponent(`export function resolve(n,c,next){return ['herdr','gpui-base','gpui-kit'].includes(n)?{url:${JSON.stringify(url)},shortCircuit:true}:next(n,c)}`));
const {default:Agents}=await import('../mods/agents-order/main.js');

test('同组含 shell 时按松手位置写入标签，清除预览后仍保持顺序',async()=>{
  globalThis.dropTerminals=['a','b'].map(address=>({address,state:'live',labels:{}}));
  const members=['a','b'].map(address=>({address,space:'s'}));
  const view=new Agents();
  Object.assign(view,{busy:new Set(),previews:new Map(),drag:{space:'s',address:'a',members,origin:0,target:0,start:15,y:15,zoom:1,grabOffset:15,centers:[15,49]}});
  let saved;
  const cx={notify(){},spawn(fn){saved=fn(cx)}};
  view.finishDrag(cx,{position:{x:10,y:50}});
  await saved;
  view.previews.clear();
  assert.deepEqual(view.grouped(members,globalThis.dropTerminals).map(a=>a.address),['b','a']);
});
