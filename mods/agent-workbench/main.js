// 按 Space 展示 Agent：共享名称排序、原生拖动、最近会话与失败后的新建入口。
import { View, div, svg, image } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input } from 'gpui-base';
import { agents, terminals, panes, spaces, theme, run, hc, exec, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, notify, appHome, machines, readTextFile, writeTextFile, focused } from 'herdr';
import { taskName, validateName, ordered, reorder, recovery, recordKey, dragTarget, recentAction, pointerInBounds, dragOutcome, dropRecent, failurePrompt, dispatchFailure, tabSyncPlan, spaceTerminals, terminalName, duplicateNames, terminalSection, terminalSectionRows, toggleTerminalFold, parseFoldState, serializeFoldState, foldedFrom } from './model.js';
import { QuotaController, pickQuotaTarget, quotaKey } from './quota.js';
import { formatUsage } from './usage.js';
import { HoverHint } from './hint.js';
import { toggleFold, spaceSelectArgs, spaceHint, moveSpace, applyOrder } from './nav.js';
import { branchTokens, quotaGroups, feeSegments, feeTooltip, footerHeight, quotaLineKind, resetHint, quotaTooltip, silentState, hasValue, refreshStamp } from './visual.js';
import { backgroundRows, backgroundAction, rowSelected, backgroundRow } from './subagents.js';
import { statusIcon } from './status.js';

// 待批入口开关：false = 侧栏不显示「待批」一行（2026-11-15 暂时停用）。
const APPROVALS_ENTRY = false;
import { createConversation } from './operations.js';
const HISTORY='workbench.history.v1';
// 失败弹窗的选择通过 shared 回传：框关闭后由侧栏执行且只执行一次。
const INTENT='workbench.failure.intent';
// 终端小节折叠按 Space 存 localStorage；写失败静默忽略。
const FOLD_KEY='agent-workbench.termFolded';
const ROW=46,ROW_H=42,LIFT_H=48,LIFT=3,TREE_X=18,TICK_W=7;
// 终端区比 agent 行更紧凑：行 28、间距 32，标题 20、「还有 N 条」22。
const TERM_ROW=32,TERM_HEAD=20,TERM_MORE=22;
const DIAG='/tmp/herdr-drag-diag.log';
const LAUNCH={codex:['codex','--no-daemon'],claude:['claude'],opencode:['opencode'],'dsh-tui':['dsh-tui']};
function chevron(collapsed,t) {
  return h_flex().w(12).h(12).flex_none().items_center().justify_center()
    .child(svg(`mods/agent-workbench/${collapsed?'chevron-right':'chevron-down'}.svg`).size(12).text_color(t.muted));
}
function nativeWindow(){try{return typeof window!=='undefined'?window:null;}catch{return null;}}
function windowActive(){const w=nativeWindow();try{return w&&typeof w.is_window_active==='function'?w.is_window_active():true;}catch{return true;}}
function pointerNow(){const w=nativeWindow();try{return w&&typeof w.mouse_position==='function'?w.mouse_position():null;}catch{return null;}}
function button(id,text,action) {
  const t=theme();
  return div().id(id).px(9).py(5).rounded(6).bg(t.raised).text_color(t.foreground).cursor_pointer().on_click(action).child(text);
}
export default class Workbench extends View {
  init(_p,cx) {
    this.ctx=cx; this.closed=false;
    // 项目菜单是独立 popup：只聚焦，不启动额度/发现/历史等侧栏计时器。
    if(props()?.spaceMenu){ this.handle=cx.focus_handle(); this.handle.focus(); return; }
    // 恢复失败弹窗：独立 overlay，只聚焦，不启动侧栏计时器。
    if(props()?.failed){ this.handle=cx.focus_handle(); this.handle.focus(); return; }
    this.folded=new Set(); this.termExpanded=new Set();
    this.termFolded=foldedFrom(parseFoldState(localStorage.getItem(FOLD_KEY))); this.busy=new Set(); this.recentOpen=false; this.showAllRecent=false; this.dragTimer=null;
    this.hint=new HoverHint({
      schedule:(fn,ms)=>cx.timer.after(ms,()=>fn()),
      onChange:()=>{if(!this.closed){try{this.ctx?.notify();}catch{}}},
    });
    this.quota=new QuotaController({
      load:id=>this.loadQuota(id),
      onChange:()=>{if(!this.closed){try{this.ctx?.notify();}catch{}}},
    });
    // 费用估算独立于额度：只在额度不可用时显示，独立 key/缓存。
    this.usage=new QuotaController({
      load:id=>this.loadUsage(id),
      onChange:()=>{if(!this.closed){try{this.ctx?.notify();}catch{}}},
    });
    if(!props()?.rename){
      this.quotaTimer=cx.timer.every(250,cx=>{this.syncQuota(cx);this.syncUsage(cx);});
      this.syncQuota(cx);this.syncUsage(cx);
      // 弹窗关闭后回传的选择：立即执行一次，不改弹窗自身的状态。
      this.intentTimer=cx.timer.every(300,cx=>this.applyIntent(cx));
    }
    this.handle=cx.focus_handle(); this.drag=null; this.hover=null; this.hoverSpace=null; this.rootWidth=null; this.error='';
    this.orderPreviews=new Map();
    if(props()?.rename) this.initRename(cx);
    // 重启后恢复上次可确认的任务快照；只保留元数据，不保存终端内容。
    this.last=shared(HISTORY)??{};
    if(!props()?.rename){cx.timer.every(15000,cx=>this.discover(cx));this.discover(cx);this.alignTabs();}
  }
  initRename(cx) {
    const name=props().name??'';
    this.input=InputState.new({value:name});
    // macOS 习惯：打开即全选原名，直接输入即可替换。
    if(name)this.input.set_selected_range({start:0,end:name.length});
    this.inputFocused=true;
    this.input.on('change',(_e,cx)=>{this.error='';cx.notify();});
    this.input.on('focus',(_e,cx)=>{this.inputFocused=true;cx.notify();});
    this.input.on('blur',(_e,cx)=>{this.inputFocused=false;cx.notify();});
    this.input.on('submit',(_e,cx)=>this.saveName(cx));
    this.input.focus();
    // 覆盖层拿到键盘前先聚焦，稍后再兜底一次。
    cx.timer.after(600,()=>this.input.focus());
  }
  async label(address,values) {
    const r=await hc(['label',address,...Object.entries(values).map(([k,v])=>`${k}=${v}`)]);
    if(r.code!==0) throw new Error('标签写入失败');
  }
  saveName(cx) {
    if(this.busy.has('rename')) return;
    const p=props(), name=this.input.value().trim();
    this.error=validateName(name,p.siblings??''); if(this.error){cx.notify();return;}
    this.busy.add('rename');cx.notify();
    cx.spawn(async cx=>{
      try {await this.label(p.address,{'workbench.name':name});this.syncTab(p.address,name);closeOverlay(p.overlay);}
      catch {this.error='名称未保存，请重试';}
      finally{this.busy.delete('rename');cx.notify();}
    });
  }
  // 任务名同步到该 Agent 独占的 tab；失败只提示，不回滚任务名。
  syncTab(address,name) {
    const plan=tabSyncPlan(panes(),agents().find(a=>a.address===address),name);
    if(!plan)return;
    try {run('tab.rename',plan);}
    catch {notify({title:'标签页未改名',body:'任务名已保存，标签页名称未同步',level:'warning'});}
  }
  // 一次性对齐：已有工作台名的 Agent，其独占 tab 同步到工作台名；共用 tab 不动。
  alignTabs() {
    const all=terminals();
    for(const a of agents()) {
      const name=all.find(t=>t.address===a.address)?.labels?.['workbench.name'];
      if(name)this.syncTab(a.address,name);
    }
  }
  rename(agent,labels) {
    const all=terminals(), normal=agents();
    const subs=backgroundRows(all,normal,agent.space,panes());
    const siblings=[...normal,...subs].filter(a=>a.space===agent.space&&a.address!==agent.address)
      .map(a=>a.background?a.name:taskName(a,all.find(t=>t.address===a.address)?.labels??{}));
    const name=agent.background?agent.name:taskName(agent,labels);
    openOverlay({mod:'agent-workbench',kind:'dialog',width:400,props:{rename:true,address:agent.address,name,siblings}});
  }
  renameView() {
    const t=theme(), busy=this.busy.has('rename'), name=this.input.value();
    const button=(id,text,primary,action)=>h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary?t.solid:t.input).bg(primary?t.solid:t.raised)
      .text_color(primary?t.solid_foreground:t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s=>s.opacity(0.88)).on_click(action).child(text);
    const save=button('save-name',busy?'保存中…':'保存',true,(_e,cx)=>this.saveName(cx));
    return v_flex().id('rename-dialog').w_full().bg(t.popover).text_color(t.foreground)
      .child(v_flex().p(20)
        .child(h_flex().items_center()
          .child(div().flex_1().text_size(15).font_semibold().child('重命名任务'))
          .child(div().text_size(11).text_color(t.dim).child('Esc')))
        .child(div().pt(5).text_size(11.5).text_color(t.muted).child('同一 Space 内不能重名'))
        .child(h_flex().pt(16).pb(7).items_center()
          .child(div().flex_1().text_size(11.5).text_color(t.muted).child('任务名'))
          .child(div().text_size(11).text_color(t.dim).child(`${[...name].length}/16`)))
        .child(Input.new(this.input).h(38).px(10).rounded(9).text_size(13)
          .border_1().border_color(this.inputFocused?t.accent:t.input).bg(t.background).text_color(t.foreground))
        .child(div().pt(7).child(div().id('rename-msg').h(18).text_size(11.5).text_color(this.error?t.blocked:t.dim)
          .child(this.error||'最多 16 字，名称会同步到其他窗口'))))
      .child(div().h(1).bg(t.border))
      .child(h_flex().px(20).py(14).gap(8).items_center().justify_end()
        .child(button('cancel-name','取消',false,()=>closeOverlay(props().overlay)))
        .child(busy?save.opacity(0.5):save));
  }
  snapshot(list,all) {
    this.last=shared(HISTORY)??this.last;
    let changed=false;
    const next={...this.last};
    for(const a of list) {
      const term=all.find(t=>t.address===a.address), p=panes().find(p=>p.terminal===a.address);
      const id=recordKey(a.address,{'workbench.pid':term?.foreground?.pid,...term?.labels});
      const previous=next[id];
      const entry={id,address:a.address,space:a.space,spaceName:a.space_name,machine:spaces().find(s=>s.id===a.space)?.machine??null,name:taskName(a,term?.labels??{}),program:a.program?.key,cwd:p?.cwd??term?.cwd,
        sessionId:term?.labels?.['workbench.session']||undefined,verified:!!term?.labels?.['workbench.session']&&term?.labels?.['workbench.identity']!=='uncertain',state:'active',at:previous?.at??Date.now()};
      if(JSON.stringify(entry)!==JSON.stringify(previous)){next[id]=entry;changed=true;}
      for(const [oldId,old] of Object.entries(next))if(old.address===a.address&&oldId!==id){if(!old.id||oldId===a.address+':'+(term?.labels?.['workbench.pid']??term?.foreground?.pid)||oldId.endsWith(':initial')||oldId.endsWith(':pending')){delete next[oldId];changed=true;}else if(old.state==='active'){next[oldId]={...old,state:'recent'};changed=true;}}
    }
    const active=new Set(list.map(a=>recordKey(a.address,{'workbench.pid':all.find(t=>t.address===a.address)?.foreground?.pid,...all.find(t=>t.address===a.address)?.labels})));
    for(const [id,r] of Object.entries(next)) {
      if(r.state==='active'&&!active.has(id)) {
        if(r.address.includes('/')&&machines().find(m=>m.name===r.address.split('/')[0])?.layout!=='ready')continue;
        const terminal=all.find(t=>t.address===r.address);
        // 窗口启动时数据可能尚未加载；活终端保留，等待下一次快照。
        if(terminal?.state==='live'&&terminal.program?.agent&&recordKey(r.address,terminal.labels)===id) continue;
        next[id]={...r,state:'recent',at:Date.now()};changed=true;
      }
    }
    if(changed){this.last=next;setShared(HISTORY,next);}
  }
  restore(record,cx) {
    if(this.busy.has(record.address)) return;
    const current=terminals().find(t=>t.address===record.address);
    const live=agents().some(a=>a.address===record.address)&&((record.sessionId&&current?.labels?.['workbench.session']===record.sessionId)||recordKey(record.address,current?.labels)===record.id||String(record.id??'').startsWith(record.address+':'+current?.labels?.['workbench.pid']+':'));
    const result=recovery(record,live);
    if(result.state==='live'){run('pane.focus',{terminal:record.address});return;}
    if(result.state==='ready'){this.resume(record,result.argv,cx);return;}
    this.failDialog(record,result.reason);
  }
  discover(cx) {
    if(this.probing)return;this.probing=true;
    cx.spawn(async cx=>{
      try {
        for(const a of agents()) {
          if(!['codex','claude','opencode','dsh-tui'].includes(a.program?.key)||a.address.includes('/'))continue;
          const data=await hc(['get',a.address]);if(data.code!==0)continue;
          const terminal=JSON.parse(data.stdout);
          if(!terminal.foreground?.pid)continue;
          const pid=String(terminal.foreground.pid);
          
          if(terminal.labels?.['workbench.pid']!==pid)await this.label(a.address,{'workbench.session':'','workbench.pid':pid});
          const probe=await exec('node',[appHome()+'/mods/agent-workbench/probe.mjs',String(terminal.foreground.pid),a.program.key]);
          const id=JSON.parse(probe.stdout).sessionId;
          if(id){if(terminal.labels?.['workbench.session']!==id||terminal.labels?.['workbench.identity']==='uncertain')await this.label(a.address,{'workbench.session':id,'workbench.identity':'verified'});}
          else if(terminal.labels?.['workbench.identity']!=='uncertain')await this.label(a.address,{'workbench.identity':'uncertain'});
        }
      }catch{ /* 无法验证身份时，恢复入口会明确说明原因。 */ }
      finally{this.probing=false;cx.notify();}
    });
  }
  resume(record,argv,cx) {
    if(this.busy.has(record.address))return;this.busy.add(record.address);
    cx.spawn(async cx=>{
      let replacement=null,locked=false;
      try {
        const lock=await exec('node',[appHome()+'/mods/agent-workbench/lock.mjs','acquire',record.id??record.address]);
        if(lock.code!==0){this.error='另一窗口正在恢复此会话';return;}locked=true;
        if(['replaced','restored'].includes((shared(HISTORY)??{})[record.id??record.address]?.state)){this.error='此记录已经处理，请刷新查看';return;}
        if(record.program==='opencode'&&!record.machine)argv=['node',appHome()+'/mods/agent-workbench/opencode-launch.mjs',...argv.slice(1)];
        replacement=(await createConversation(exec,{space:record.space,spaceName:spaces().some(s=>s.id===record.space)?undefined:record.spaceName,machine:record.machine,name:record.name,folder:record.cwd,argv})).terminal;
        let verified=false;
        for(let i=0;i<20&&!verified;i++) {
          await exec('node',['-e','setTimeout(()=>{},300)']);
          const result=await hc(['get',replacement]);if(result.code!==0)continue;
          const terminal=JSON.parse(result.stdout);
          if(!terminal.foreground?.pid)continue;
          const probe=await exec('node',[appHome()+'/mods/agent-workbench/probe.mjs',String(terminal.foreground.pid),record.program]);
          verified=JSON.parse(probe.stdout).sessionId===record.sessionId;
        }
        this.last=shared(HISTORY)??this.last;
        this.last={...this.last,[record.id??record.address]:{...record,replacement,state:verified?'restored':'failed',reason:verified?null:'恢复进程已启动，但尚未确认原上下文；再次点击可查看终端'}};
        setShared(HISTORY,this.last);
        await this.label(replacement,{'workbench.name':record.name});
        notify({title:verified?'原会话已载入':'请检查恢复终端',body:verified?'已确认进程打开原会话记录':'尚未确认原上下文',level:'info'});
      }catch{this.last={...this.last,[record.id??record.address]:{...record,replacement,state:'failed',reason:'恢复启动或验证失败，请检查原目录与 Agent'}};setShared(HISTORY,this.last);}
      finally{try{if(locked)await exec('node',[appHome()+'/mods/agent-workbench/lock.mjs','release',record.id??record.address]);}finally{this.busy.delete(record.address);cx.notify();}}
    });
  }
  fresh(record,cx) {
    if(this.busy.has(record.address))return;
    if(record.replacement&&terminals().some(t=>t.address===record.replacement&&t.state==='live')){run('pane.focus',{terminal:record.replacement});return;}
    this.busy.add(record.address);cx.notify();
    cx.spawn(async cx=>{
      let locked=false;
      try {
        const lock=await exec('node',[appHome()+'/mods/agent-workbench/lock.mjs','acquire',record.id??record.address]);
        if(lock.code!==0){this.error='另一窗口正在处理此会话';return;}locked=true;
        if(['replaced','restored'].includes((shared(HISTORY)??{})[record.id??record.address]?.state)){this.error='此记录已经处理，请刷新查看';return;}
        let argv=LAUNCH[record.program]; if(record.program==='opencode'&&!record.machine)argv=['node',appHome()+'/mods/agent-workbench/opencode-launch.mjs']; if(!argv)throw new Error('不支持');
        const created=await createConversation(exec,{space:record.space,spaceName:spaces().some(s=>s.id===record.space)?undefined:record.spaceName,machine:record.machine,name:record.name,folder:record.cwd,argv});
        this.last={...this.last,[record.id??record.address]:{...record,state:'replaced'}};setShared(HISTORY,this.last);
        try {await this.label(created.terminal,{'workbench.name':record.name});}
        catch{this.error='新对话已创建，任务名尚未同步，请在新对话行中改名';}
        notify({title:'已新建对话',body:'原上下文未恢复',level:'info'});
      }catch{this.error='新建失败：请检查 Agent 命令、目录和 Space 是否可用';}
      finally{try{if(locked)await exec('node',[appHome()+'/mods/agent-workbench/lock.mjs','release',record.id??record.address]);}finally{this.busy.delete(record.address);cx.notify();}}
    });
  }
  // 删除失败记录：只移除本地快照，点了立即生效；不杀进程、不动原会话。
  dismiss(record) {
    if(this.busy.has(record.address))return;
    const next=dropRecent(this.last,record.id??record.address);
    if(next===this.last)return;
    this.last=next;setShared(HISTORY,next);this.ctx?.notify();
  }
  // 恢复失败：只弹提示，不改任何记录；用户选了才执行，取消零副作用。
  failDialog(record,reason) {
    openOverlay({mod:'agent-workbench',kind:'dialog',width:400,props:{failed:true,record,reason:reason||record.reason}});
  }
  // 弹窗选择：先清意图再执行，重复定时器与重复点击都不会执行第二次。
  applyIntent(cx) {
    const it=shared(INTENT);if(!it?.action)return;
    setShared(INTENT,null);
    dispatchFailure(it.action,{
      fresh:()=>this.fresh(it.record,cx),
      dismiss:()=>this.dismiss(it.record),
    });
    cx.notify();
  }
  failureView() {
    const t=theme(), p=props()??{}, prompt=failurePrompt(p.reason);
    const choose=(action)=>()=>{
      if(this.picked)return;this.picked=true;
      setShared(INTENT,{action,record:p.record});closeOverlay(p.overlay);
    };
    const item=(id,label,primary,action)=>h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary?t.solid:t.input).bg(primary?t.solid:t.raised)
      .text_color(primary?t.solid_foreground:t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s=>s.opacity(0.88)).on_click(action).child(label);
    // 关闭只靠点遮罩与 Esc（dialog 默认行为）；两者都不产生动作。
    return v_flex().id('failure-dialog').w_full().bg(t.popover).text_color(t.foreground)
      .track_focus(this.handle)
      .child(v_flex().p(20)
        .child(h_flex().items_center()
          .child(div().flex_1().text_size(15).font_semibold().child(prompt.title))
          .child(div().text_size(11).text_color(t.dim).child('Esc')))
        .child(div().pt(6).text_size(11.5).text_color(t.muted).child(p.record?.name??'该会话'))
        .child(div().pt(8).text_size(12).text_color(t.blocked).child(prompt.reason)))
      .child(div().h(1).bg(t.border))
      .child(h_flex().px(20).py(14).gap(8).items_center().justify_end()
        .child(item('discard-failed','删除记录',false,choose('dismiss')))
        .child(item('fresh-failed','新建对话',true,choose('fresh'))));
  }
  diag(entry) {
    this.diagLog??=[];this.diagLog.push({...entry,at:Date.now()});
    if(this.diagLog.length>200)this.diagLog.splice(0,50);
  }
  flushDiag(tag) {
    const log=this.diagLog??[];if(!log.length)return;this.diagLog=[];
    const text='--- '+tag+' '+new Date().toISOString()+' fail='+(this.diagFail??0)+'\n'+log.map(x=>JSON.stringify(x)).join('\n')+'\n';
    // writeTextFile 是 compare-and-swap：expected 必须是当前内容；null 只表示新建。
    this.diagQueue=(this.diagQueue??Promise.resolve()).then(async()=>{
      try{
        const cur=await readTextFile(DIAG),LIMIT=4096;
        let base=cur??'';
        if(base.length+text.length>LIMIT){
          // 按记录边界裁掉最旧的整段，保留完整记录。
          const cut=base.length-Math.max(0,LIMIT-text.length),idx=base.indexOf('--- ',cut);
          base=idx>0?base.slice(idx):'';
        }
        await writeTextFile(DIAG,base+text,cur??null);
      }
      catch{this.diagFail=(this.diagFail??0)+1;}
    });
  }
  beginDrag(agent,group,ids,index,e,cx) {
    if(this.busy.has(group))return;
    this.handle.focus();
    const localY=e.local_position?.y??0;
    // 源 Space、源列表顶边与行索引都记下来；之后只用窗口坐标。
    this.drag={address:agent.address,space:group,ids,index,target:index,
      start:e.position.y,startLocalY:localY,listTop:e.position.y-index*ROW-localY,dy:0,rawDy:0,valid:true,moves:0,sample:{}};
    this.diag({e:'begin',x:e.position.x,y:e.position.y,index,space:group,listTop:this.drag.listTop});
    this.flushDiag('begin');
    this.watchDrag(cx);cx.notify();
  }
  watchDrag(cx) {
    this.stopDragTimer();
    // 按下期间 GPUI 没有投递 move（观测：moves=0），用原生指针位置驱动。
    this.dragTick=0;
    this.dragTimer=cx.timer.every(16,cx=>{
      if(!this.drag)return;
      const p=pointerNow();
      if(p){
        if(this.rootBounds&&!pointerInBounds(p,this.rootBounds)){this.cancelDrag(cx,'leave');return;}
        this.moveTo(p.y,cx);
      }
      if(++this.dragTick%8===0&&!windowActive())this.cancelDrag(cx,'blur');
    });
  }
  stopDragTimer() {this.dragTimer?.cancel();this.dragTimer=null;}
  moveTo(y,cx) {
    const d=this.drag;if(!d)return;
    const dy=y-d.start, last=(d.ids.length-1)*ROW;
    const ndy=Math.max(-d.index*ROW,Math.min(last-d.index*ROW,dy));
    const target=dragTarget(d.index,dy,ROW,d.ids.length);
    // rawDy 保留未夹紧的指针位移，供 4px 单击阈值判断。
    d.rawDy=dy;
    if(ndy===d.dy&&target===d.target)return;
    d.dy=ndy;d.target=target;d.valid=true;d.moves++;
    if(!d.sample.first)d.sample.first={y,target};
    d.sample.last={y,target};
    d.pendingAt=Date.now();
    cx.notify();
  }
  moveDrag(e,cx) {this.moveTo(e.position.y,cx);}
  quotaIdentity() {
    // focused().agent 不能单独作为依据：Files pane 可能残留上次的 agent 焦点。
    return pickQuotaTarget(focused(),terminals(),agents(),panes());
  }
  loadQuota(identity) {
    return exec('node',[appHome()+'/mods/agent-workbench/quota.mjs',identity.program,identity.id??''],{timeout:4000})
      .then(r=>{
        if(r.code!==0)return {status:'error',reason:'额度读取失败'};
        try{return JSON.parse(r.stdout);}catch{return {status:'error',reason:'额度输出无法解析'};}
      });
  }
  syncQuota(cx) {
    if(this.closed)return;
    if(this.quota.setTarget(this.quotaIdentity()))cx.notify();
  }
  usageIdentityFor(target) {
    if(!target)return null;
    const term=terminals().find(t=>t.address===target.address);
    const lab=term?.labels??{};
    // 明确写入的会话 ID 才用；identity=uncertain 时仍拒绝。没有 identity 标记但会话 ID 有效时不猜别的会话。
    const raw=lab['workbench.session']??'';
    const sid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw)&&lab['workbench.identity']!=='uncertain'?raw:null;
    const id=target.program==='codex'?target.id:(sid??target.id);
    return {program:target.program,id,sessionId:sid};
  }
  loadUsage(identity) {
    // 三段汇总接口（s/1d/7d）由 usage.mjs totals 提供，渲染只消费结果，不改数据层。
    return exec('node',[appHome()+'/mods/agent-workbench/usage.mjs','totals',identity.program,identity.sessionId??''],{timeout:8000})
      .then(r=>{
        if(r.code!==0)return {status:'error',reason:'费用读取失败'};
        try{return JSON.parse(r.stdout);}catch{return {status:'error',reason:'费用输出无法解析'};}
      });
  }
  syncUsage(cx) {
    if(this.closed)return;
    const q=this.quotaIdentity();
    if(this.usage.setTarget(q?this.usageIdentityFor(q):null))cx.notify();
  }
  usageLine(t,target) {
    const id=this.usageIdentityFor(target);
    const key=id?quotaKey(id):null;
    const raw=this.usage?.state;
    const same=key!==null&&this.usage.stateKey===key;
    // 无感刷新：费用同样保留上一份有效值，失败原因只进 tooltip。
    if(same&&hasValue(raw))this.usageMemory={key,state:raw,at:Date.now()};
    const state=silentState(raw,this.usageMemory?.key===key?this.usageMemory:null);
    const fmt=formatUsage(state,same);
    if(!fmt)return null;
    const stamp=refreshStamp(this.usage?.stateAt);
    const tip=[feeTooltip(state),stamp].filter(Boolean).join(' · ');
    // 三组合成一组：标签+值成对，label 11.5、值 13 medium；组间 10，不再塞 dim 分隔点。
    if(fmt.kind==='ready'||fmt.kind==='partial'||fmt.kind==='unknown'){
      const pairs=feeSegments(state).map(seg=>
        h_flex().flex_none().items_center().gap(4)
          .child(div().text_size(11.5).line_height('16px').text_color(t.muted).child(seg.label))
          .child(div().text_size(13).font_medium().line_height('16px').text_color(seg.value?t.foreground:t.muted).opacity(seg.value?0.60:1).child(seg.value??'–')));
      return h_flex().id('usage-totals').items_center().gap(10).flex_wrap()
        .when(tip,e=>e.tooltip(tip)).children(pairs);
    }
    const short=fmt.kind==='loading'?'费用估算读取中…':'费用估算失败';
    return div().id('usage-estimate').text_size(12.5)
      .text_color(fmt.kind==='error'?t.blocked:t.muted)
      .when(tip,e=>e.tooltip(tip))
      .child(short);
  }
  quotaView(target) {
    if(!target)return null;
    const key=quotaKey(target), same=this.quota.stateKey===key;
    const raw=same?this.quota.state:{status:'loading'};
    const t=theme(),now=Date.now();
    const name={codex:'Codex',claude:'Claude',opencode:'OpenCode','dsh-tui':'DeepSeek'}[target.program]??target.program;
    // 无感刷新：记住上一份有效值，刷新/失败期间继续显示，不出现「读取中/刷新中」。
    if(same&&hasValue(raw))this.quotaMemory={key,state:raw,at:now};
    const st=silentState(raw,this.quotaMemory?.key===key?this.quotaMemory:null)??{status:'loading'};
    const shown=st;
    const age=shown.status==='ready'&&shown.snapshotAt?now-shown.snapshotAt:null;
    // 费用与额度二选一：费用可用时替换额度未知占位，不额外加一块“未知”。
    const shell=(lines)=>v_flex().id('quota').flex_none().h(footerHeight(this.rootWidth)).px(14).py(11).gap(7)
      .border_t_1().border_color(t.border).bg(t.chrome)
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(12.5).font_medium().line_height('16px').text_color(t.foreground).child(name))
        .when(shown.status==='ready'&&shown.plan,e=>e.child(div().text_size(12).line_height('16px').text_color(t.muted).child(shown.plan)))
        .child(div().flex_1()))
      .child(v_flex().id('quota-lines').gap(6).children(lines));
    // 费用行只在 quota 无数据源（unknown）时使用；loading/error/过期不盖额度状态。
    const usage=st.status==='unknown'?this.usageLine(t,target):null;
    const kind=quotaLineKind(st.status,age,Boolean(usage),st.reason);
    const statusLine=(text,color=t.muted)=>div().text_size(12.5).text_color(color).child(text);
    if(kind==='usage')return shell([usage]);
    if(kind==='loading')return shell([statusLine('额度读取中…')]);
    if(kind==='error')return shell([statusLine('额度读取失败',t.blocked)])
      .when(st.reason,e=>e.tooltip(String(st.reason)));
    if(kind==='unknown')return shell([statusLine('额度未知')])
      .when(st.reason,e=>e.tooltip(String(st.reason)));
    if(kind==='stale')return shell([statusLine(/无快照时间/.test(String(st.reason??''))||age===null?'额度未知（无快照时间）':'额度未知（快照过旧）')])
      .tooltip(st.reason?String(st.reason):(age===null?'缺少快照时间':'快照超过 1 小时'));
    const groups=quotaGroups(shown);
    const line=groups.length
      ? h_flex().items_center().gap(16).flex_wrap().children(groups.map(g=>
          h_flex().flex_none().items_center().gap(4)
            .child(div().text_size(11.5).line_height('16px').text_color(t.muted).child(g.label))
            .child(div().text_size(13).font_medium().line_height('16px').text_color(g.low?t.blocked:t.foreground).opacity(g.low?1:0.60).child(g.value))))
      : div().text_size(12.5).text_color(t.muted).child('额度未知');
    // Codex 三行：品牌+plan / 额度组 / 重置行；1d/7d 费用只进 tooltip，不占版面高度。
    const reset=resetHint(shown);
    const usageState=this.usage?.stateKey===key?this.usage.state:null;
    const tip=quotaTooltip(shown,{ageMs:age,refreshedAt:this.quota.stateAt,failure:raw.status==='error'?raw.reason:null,usageState});
    return shell([line,reset?div().id('quota-reset').text_size(11.5).line_height('16px').text_color(t.muted).child(reset):null].filter(Boolean))
      .when(tip,e=>e.tooltip(tip));
  }
  cancelDrag(cx,src='other') {
    if(!this.drag)return;
    this.diag({e:'cancel',src,moves:this.drag.moves??0,lagMax:this.drag.lagMax??0,lagN:this.drag.lagN??0,sample:this.drag.sample??null});
    this.stopDragTimer();this.drag=null;this.flushDiag('cancel');cx.notify();
  }
  finishDrag(cx) {
    const d=this.drag;this.drag=null;this.lastDragEnd=Date.now();this.stopDragTimer();
    if(!d){cx.notify();return;}
    const outcome=dragOutcome(d,4);
    this.diag({e:'finish',outcome,target:d.target,valid:d.valid,moves:d.moves??0,lagMax:d.lagMax??0,lagN:d.lagN??0,sample:d.sample??null});this.flushDiag('finish');
    if(outcome==='focus'){cx.notify();run('pane.focus',{terminal:d.address});return;}
    if(outcome!=='reorder'){cx.notify();return;}
    const ids=reorder(d.ids,d.address,d.target);
    const old=Object.fromEntries(terminals().map(t=>[t.address,t.labels?.['workbench.order']??'']));
    // 标签回写是异步的：先保留本地目标顺序，避免松手先弹回旧位置。
    this.orderPreviews.set(d.space,{ids,at:Date.now()});
    this.busy.add(d.space);
    cx.spawn(async cx=>{
      try {
        // 每个地址携带自己的顺序，其他窗口直接读取 core 标签。
        for(let i=0;i<ids.length;i++)await this.label(ids[i],{'workbench.order':String(i)});
      }catch{const preview=this.orderPreviews.get(d.space);if(preview?.ids===ids)this.orderPreviews.delete(d.space);for(const id of ids){try{await this.label(id,{'workbench.order':old[id]});}catch{}}this.error='顺序同步失败，已尝试还原，请重试';}
      finally{this.busy.delete(d.space);cx.notify();}
    });cx.notify();
  }
  row(agent,all,index,ids,group) {
    const t=theme(), labels=all.find(x=>x.address===agent.address)?.labels??{};
    const name=taskName(agent,labels), d=this.drag;
    const projected=d?.space===group?reorder(ids,d.address,d.target):ids;
    const moved=d?.address===agent.address;
    const top=moved?index*ROW+(d.dy??0)-LIFT:projected.indexOf(agent.address)*ROW;
    const icon=agent.program?.icon, hovered=this.hover===agent.address;
    // 边框常驻（常态与底色同色），按下只换色，内容不因边框挤动。
    const selected=rowSelected(agent,focused()?.shown,moved), inset=moved?10:12;
    return h_flex().id(`agent-${agent.address}`).absolute().top(top).left(inset).right(moved?0:2).h(moved?LIFT_H:ROW_H).pl(6).pr(10).gap(6)
      .border_1().border_color(moved?t.accent:(selected?t.selected:t.chrome))
      .transition('height',100).transition('left',100)
      // 让位用 160ms；松手落位用 100ms，避免收回时跳变。
      .when(!moved,e=>e.transition('top',d?160:100)).when(moved,e=>e.shadow_2xl().cursor_grabbing())
      .when(!selected,e=>e.hover(s=>s.bg(t.hover)))
      .rounded(8).when(selected,e=>e.bg(t.selected)).items_center()
      .when(selected,e=>e.child(div().absolute().left(0).top(7).bottom(7).w(2).rounded(1).bg(t.accent)))
      .on_hover((on,cx)=>{this.hover=on?agent.address:null;cx.notify();})
      .on_click(()=>{if(!this.drag&&Date.now()-(this.lastDragEnd??0)>300){const f=focused();if(f?.shown&&f.pane)run('terminal.show',{pane:f.pane});run('pane.focus',{terminal:agent.address});}})
      .on_mouse_move((event,cx)=>this.moveDrag(event,cx))
      .child(h_flex().id(`drag-${agent.address}`).w(30).h_full().items_center().justify_center().cursor_grab()
        .when(this.hint.shown===agent.address,e=>e.tooltip('按住拖动排序'))
        .on_hover((on,cx)=>{if(on){if(!this.drag)this.hint.enter(agent.address);}else this.hint.leave();})
        .on_mouse_down('left',(e,cx)=>{this.hint.press();this.beginDrag(agent,group,ids,index,e,cx);})
        // 图标上移半行，中心对齐两行文本的第一行；状态/编辑笔仍保持行内居中。
        .child(div().mt(-9).child(icon?(agent.program.tint?svg(icon).size(16).text_color(t.muted):image(icon).size(16)):div())))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(11).text_color(t.muted).child(agent.program?.name??'Agent'))
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(name)))
      .child(h_flex().id(`rename-${agent.address}`).w(16).h(16).items_center().justify_center().text_color(t.dim).opacity(hovered?1:0)
        .tooltip('修改任务名')
        .when(hovered,e=>e.cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();this.rename(agent,labels);}))
        .child(svg('mods/agent-workbench/pencil.svg').size(14).text_color(t.dim)))
      .child(statusIcon(agent.status,t));
  }
  // 终端行：只读展示，点击聚焦；不参与拖动、不写标签、不进额度。
  termRow(terminal,top,dup,t) {
    const name=terminalName(terminal);
    return h_flex().id(`term-${terminal.address}`).absolute().top(top).left(26).right(2).h(28).pl(6).pr(10).gap(6)
      .rounded(6).items_center().cursor_pointer().hover(s=>s.bg(t.hover))
      .on_click(()=>run('pane.focus',{terminal:terminal.address}))
      .child(svg('icons/shell.svg').size(12).text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(name))
      .when(dup.has(name),e=>e.child(div().flex_none().text_size(11).text_color(t.dim).child(terminal.address)));
  }
  subRow(terminal,list,all,spaceId,index) {
    const t=theme(), labels=all.find(x=>x.address===terminal.address)?.labels??{};
    const parent=list.find(a=>a.address===terminal.parent);
    const parentLabels=all.find(x=>x.address===terminal.parent)?.labels??{};
    const parentName=parent?taskName(parent,parentLabels):(terminal.parentName??terminal.parent??'Agent');
    const bg=backgroundRow(terminal,parentName,parent?.program??null);
    const shown=focused()?.shown===terminal.address, hovered=this.hover===terminal.address;
    return h_flex().id(`agent-${terminal.address}`).absolute().top(index*ROW).left(12).right(2).h(ROW_H).pl(6).pr(10).gap(6)
      .border_1().border_color(shown?t.selected:t.chrome)
      .when(!shown,e=>e.hover(s=>s.bg(t.hover)))
      .rounded(8).when(shown,e=>e.bg(t.selected)).items_center()
      .when(shown,e=>e.child(div().absolute().left(0).top(7).bottom(7).w(2).rounded(1).bg(t.accent)))
      .on_hover((on,cx)=>{this.hover=on?terminal.address:null;cx.notify();})
      .tooltip(bg.tooltip)
      .on_click(()=>{
        if(this.drag||Date.now()-(this.lastDragEnd??0)<=300)return;
        const action=backgroundAction(terminal,panes().some(p=>p.focused));
        if(action)run(action.name,action.args);
      })
      .child(h_flex().w(30).h_full().items_center().justify_center()
        .when(!bg.icon,e=>e.child(div().text_size(12).text_color(t.muted).child('↳')))
        .when(bg.icon,e=>e.child(div().mt(-9).child(bg.tint?svg(bg.icon).size(16).text_color(t.muted):image(bg.icon).size(16)))))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(4).items_center()
          .child(div().text_size(11).text_color(t.muted).truncate().child(bg.program))
          .child(div().text_size(11).text_color(t.dim).child('· 后台')))
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(bg.name)))
      .child(h_flex().id(`rename-${terminal.address}`).w(16).h(16).items_center().justify_center().text_color(t.dim).opacity(hovered?1:0)
        .tooltip('修改任务名')
        .when(hovered,e=>e.cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();this.rename({...terminal,space:spaceId,background:true},labels);}))
        .child(svg('mods/agent-workbench/pencil.svg').size(14).text_color(t.dim)))
      .child(statusIcon(terminal.status??'idle',t));
  }
  group(space,list,all) {
    const t=theme();
    list=this.orderedIn(space,list,all);const ids=list.map(a=>a.address), count=list.filter(a=>a.status==='blocked').length;
    const subs=backgroundRows(all,list,space.id,panes());
    const rows=list.map((a,i)=>this.row(a,all,i,ids,space.id))
      .concat(subs.map((s,i)=>this.subRow(s,list,all,space.id,list.length+i)));
    // 拖动行最后绘制，浮在相邻行与后台行之上。
    if(this.drag?.space===space.id){const at=list.findIndex(a=>a.address===this.drag.address);if(at>=0)rows.push(rows.splice(at,1)[0]);}
    const before=list.length+subs.length;
    // 当前 Space 的「待批」入口：不新开分区，夹在 agents 与 terminals 之间。
    if (APPROVALS_ENTRY) rows.push(h_flex().id(`pending-${space.id}`).absolute().left(26).right(2).top(before*ROW).h(ROW_H)
      .pl(6).pr(10).gap(6).items_center().cursor_pointer().rounded(6).hover(s=>s.bg(t.hover))
      .on_click(()=>{const req={space:space.id,at:Date.now(),nonce:`${space.id}-${Date.now()}`};setShared('approvals.openRequest',req);setShared('approvals.lastOpen',{...req,stage:'click',result:null});})
      .child(svg('mods/agent-workbench/attention.svg').size(13).text_color(t.muted))
      .child(div().text_size(12.5).text_color(t.muted).child('待批')));
    const total=before+1;
    const terms=spaceTerminals(all,list,panes(),space.id);
    const foldedTerm=this.termFolded.has(space.id);
    const win=terminalSectionRows(terms,{folded:foldedTerm,expanded:this.termExpanded.has(space.id)});
    const dup=duplicateNames(terms), sec=terminalSection(terms.length);
    const termTop=total*ROW;
    const termExtra=terms.length?TERM_HEAD+win.shown.length*TERM_ROW+(win.more?TERM_MORE:0):0;
    // 标题行整行可点：折叠/展开；标题与计数分开，避免「终端 3」被读成编号。
    const termViews=terms.length?[h_flex().id(`term-head-${space.id}`).absolute().left(26).right(2).top(termTop).h(TERM_HEAD)
      .items_center().gap(4).cursor_pointer().hover(s=>s.opacity(0.85))
      .on_click((_e,cx)=>{
        cx.stop_propagation();
        this.termFolded=toggleTerminalFold(this.termFolded,space.id);
        try{localStorage.setItem(FOLD_KEY,serializeFoldState(this.termFolded));}catch{}
        cx.notify();
      })
      .child(chevron(foldedTerm,t))
      .child(div().text_size(11).text_color(t.dim).child(sec.title))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child(String(sec.count)))]
      .concat(win.shown.map((x,i)=>this.termRow(x,termTop+TERM_HEAD+i*TERM_ROW,dup,t)))
      .concat(win.more?[h_flex().id(`term-more-${space.id}`).absolute().left(26).right(2).top(termTop+TERM_HEAD+win.shown.length*TERM_ROW).h(TERM_MORE)
        .items_center().cursor_pointer().text_size(11).text_color(t.accent)
        .on_click((_e,cx)=>{this.termExpanded.add(space.id);cx.notify();})
        .child(div().child('还有 '+win.more+' 条'))]:[]):[];
    const folded=this.folded.has(space.id), active=space.active, hint=spaceHint(list.length);
    return v_flex().gap(4).mb(8)
      .child(v_flex().id(`space-${space.id}`).gap(2).px(8).pb(4).rounded(6)
        .hover(s=>s.bg(t.hover))
        .on_mouse_down('right',(_e,cx)=>{cx.stop_propagation();this.spaceMenu(space);})
        .child(h_flex().h(24).gap(2).items_center()
          .child(h_flex().id(`fold-${space.id}`).w(18).h(24).flex_none().items_center().justify_center()
            .cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();this.folded=toggleFold(this.folded,space.id);cx.notify();})
            .child(chevron(folded,t)))
          .child(h_flex().id(`select-${space.id}`).flex_1().min_w(0).h(24).items_center().gap(6).cursor_pointer()
            .on_click(()=>run('space.select',spaceSelectArgs(space)))
            .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(active?t.foreground:t.muted).child(space.name))
            .when(count,e=>e.child(statusIcon('blocked',t)).child(div().text_size(11).text_color(t.muted).child(String(count)))))
          .child(h_flex().id(`space-menu-${space.id}`).w(16).h(24).flex_none().items_center().justify_center()
            .text_color(t.dim).opacity(this.hoverSpace===space.id?1:0)
            .on_hover((on,cx)=>{this.hoverSpace=on?space.id:null;cx.notify();})
            .when(this.hoverSpace===space.id,e=>e.cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();this.spaceMenu(space);}))
            .child(svg('mods/agent-workbench/ellipsis.svg').size(12))))
        // 完整 branch 独占第二行；斜杠/连字符后可断行，不再横向挤占项目名。
        .when(Boolean(space.branch),e=>e.child(
          h_flex().id(`branch-${space.id}`).pl(20).pr(2).gap(4).items_start().tooltip(space.branch)
            .child(svg('mods/workspace-chrome/branch.svg').size(11).flex_none().text_color(t.accent))
            .child(h_flex().flex_1().min_w(0).flex_wrap().gap(0).items_start().children(
              branchTokens(space.branch).map(part=>div().flex_none().text_size(11).line_height('13px').text_color(t.muted).child(part)))))))
      .when(!folded,e=>e.child(div().id(`rows-${space.id}`).relative().h(total*ROW+termExtra)
        // 极轻树线：项目折叠箭头下方起，连到每行图标左侧。
        .when(total,e=>e
          .child(div().absolute().left(TREE_X).top(0).w(1).h((total-1)*ROW+ROW_H/2).bg(t.border))
          .children(Array.from({length:total},(_,i)=>div().absolute().left(TREE_X).top(i*ROW+ROW_H/2).w(TICK_W).h(1).bg(t.border))))
        .children(rows.concat(termViews))))
      .when(!folded&&hint,e=>e.child(div().px(26).py(3).text_size(11).text_color(t.dim).child(hint)));
  }
  spaceMenu(space) {
    openOverlay({mod:'agent-workbench',kind:'popup',width:184,height:118,props:{spaceMenu:true,id:space.id}});
  }
  moveSpaceTo(args) {
    if(!args)return;
    closeOverlay(props().overlay);
    run('space.move',args);
  }
  moreSpace(id) {
    // 更多操作继续走官方菜单：Worktree 与关闭确认不复制、不接管。
    closeOverlay(props().overlay);
    openOverlay({mod:'menu',kind:'popup',width:200,height:260,props:{tab:'space',target:{id}}});
  }
  spaceMenuView() {
    const t=theme(), p=props()??{}, all=spaces(), space=all.find(s=>s.id===p.id);
    const up=moveSpace(all,p.id,-1), down=moveSpace(all,p.id,1);
    const item=(id,label,enabled,action)=>h_flex().id(id).h(30).px(8).gap(8).rounded(6).items_center()
      .text_color(enabled?t.foreground:t.dim)
      .when(enabled,e=>e.cursor_pointer().hover(s=>s.bg(t.hover)).on_click(action))
      .child(div().flex_1().text_size(12.5).child(label));
    return v_flex().id('space-menu-view').w_full().p(5).bg(t.popover).text_size(12.5)
      .track_focus(this.handle)
      .on_key_down((e)=>{if(e.key==='escape')closeOverlay(p.overlay);})
      .when(!space,e=>e.child(div().px(8).py(6).text_color(t.dim).child('项目已关闭')))
      .when(space,e=>e
        .child(item('space-up','上移',!!up,()=>this.moveSpaceTo(up)))
        .child(item('space-down','下移',!!down,()=>this.moveSpaceTo(down)))
        .child(div().h(1).mx(6).my(4).bg(t.border))
        .child(item('space-more','更多操作…',true,()=>this.moreSpace(p.id))));
  }
  orderedIn(space,list,all) {
    const ranks=Object.fromEntries(all.map(x=>[x.address,x.labels?.['workbench.order']]));
    let out=ordered(list,ranks);
    const preview=this.orderPreviews.get(space.id);
    if(preview)out=applyOrder(out,preview.ids);
    return out;
  }
  reconcilePreview() {
    if(!this.orderPreviews.size)return;
    const all=terminals(), ranks=Object.fromEntries(all.map(t=>[t.address,t.labels?.['workbench.order']]));
    for(const [space,preview] of this.orderPreviews) {
      const actual=ordered(agents().filter(a=>a.space===space),ranks).map(a=>a.address);
      const same=actual.length===preview.ids.length&&actual.every((id,i)=>id===preview.ids[i]);
      // 回写期间一直保留预览；回写结束仍未一致才在 2s 后让位给标签真实顺序。
      if(same||(!this.busy.has(space)&&Date.now()-preview.at>2000))this.orderPreviews.delete(space);
    }
  }
  // 最近会话不按 Space 分组：全局一段，默认 8 条，可查看全部。
  recentView() {
    const t=theme();
    const records=Object.values(this.last).filter(r=>['recent','failed'].includes(r.state)).sort((a,b)=>(b.at??0)-(a.at??0));
    if(!records.length) return null;
    const shown=this.showAllRecent?records:records.slice(0,8);
    return v_flex().gap(4).mb(4)
      .child(h_flex().id('recent-all').h(24).px(8).gap(6).items_center().text_color(t.muted)
        .on_click((_e,cx)=>{this.recentOpen=!this.recentOpen;cx.notify();})
        .child(chevron(!this.recentOpen,t))
        .child(div().flex_1().text_size(12).font_semibold().child(`最近会话 · ${records.length}`)))
      .when(this.recentOpen,e=>e.child(v_flex().gap(2).children(shown.map(r=>this.recentRow(r,t)))))
      .when(this.recentOpen&&records.length>8,e=>e.child(div().id('recent-more').px(8).py(4).text_size(11).text_color(t.accent).cursor_pointer()
        .on_click((_e,cx)=>{this.showAllRecent=!this.showAllRecent;cx.notify();})
        .child(this.showAllRecent?'收起':'查看全部（'+records.length+'）')));
  }
  // 整行点击恢复；失败的记录只显示原因，点击重新弹选择框，不在行内放动作。
  recentRow(record,t) {
    const busy=this.busy.has(record.address), action=recentAction(record);
    return v_flex().id(`recent-${record.address}`).px(8).py(7).gap(3).rounded(8).bg(t.surface)
      .when(busy,e=>e.opacity(0.6))
      .when(action==='restore',e=>e.cursor_pointer().on_click((_e,cx)=>{if(this.busy.has(record.address))return;this.restore(record,cx);}))
      .when(action==='fresh',e=>e.cursor_pointer().on_click((_e,cx)=>{cx.stop_propagation();this.failDialog(record,record.reason);}))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(record.name))
        .when(record.spaceName,e=>e.child(div().flex_none().text_size(11).text_color(t.dim).child(record.spaceName)))
        .when(action==='restore'&&busy,e=>e.child(div().text_size(11).text_color(t.dim).child('处理中…'))))
      .when(record.reason,e=>e.child(div().text_size(11).text_color(t.blocked).child(record.reason)));
  }
  close(cx) {
    this.closed=true;this.quotaTimer?.cancel();this.intentTimer?.cancel();this.hint?.close();this.quota?.close();this.usage?.close();this.stopDragTimer();this.drag=null;this.orderPreviews.clear();
  }
  render() {
    if(props()?.spaceMenu)return this.spaceMenuView();
    if(props()?.failed)return this.failureView();
    if(props()?.rename)return this.renameView();
    this.last=shared(HISTORY)??this.last;
    const t=theme(),list=agents(),all=terminals();
    this.reconcilePreview();
    // 初始空快照不能证明所有会话均已关闭。
    if(all.length)this.snapshot(list,all);
    const target=this.quotaIdentity();
    const recent=this.recentView(), quota=this.quotaView(target);
    if(this.drag?.pendingAt){
      const lag=Date.now()-this.drag.pendingAt;
      this.drag.lagMax=Math.max(this.drag.lagMax??0,lag);
      this.drag.lagN=(this.drag.lagN??0)+1;
      this.drag.pendingAt=null;
    }
    setAgentOrder(spaces().flatMap(s=>this.orderedIn(s,list.filter(a=>a.space===s.id),all).map(a=>a.address)));
    return v_flex().id('workbench').track_focus(this.handle).relative().size_full().bg(t.chrome)
      .on_mouse_down('left',(e,cx)=>{if(e.bounds)this.rootBounds=e.bounds;})
      .on_size_change((size,cx)=>{this.rootWidth=size.width;})
      .on_key_down((e,cx)=>{if(e.key==='escape')this.cancelDrag(cx,'esc');})
      .on_mouse_move((event,cx)=>{if(event.bounds)this.rootBounds=event.bounds;if(this.drag)this.moveDrag(event,cx);})
      .on_mouse_up('left',(_e,cx)=>this.finishDrag(cx))
      .on_mouse_down_out((_e,cx)=>this.cancelDrag(cx,'outside'))
      .child(v_flex().p(10).gap(6).size_full()
        .child(h_flex().h(26).px(8).items_center()
          .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.muted).child('工作台'))
          .child(h_flex().id('space-new').w(18).h(18).items_center().justify_center().text_color(t.dim)
            .cursor_pointer().tooltip('新建 Space').on_click(()=>run('space.new'))
            .child(svg('mods/workspace-chrome/plus.svg').size(12))))
        .when(this.error,e=>e.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
        .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().pt(4).pb(4)
          .children(spaces().map(s=>this.group(s,list.filter(a=>a.space===s.id),all)))
          .when(recent,e=>e.child(recent)))
        .when(!list.length,e=>e.child(div().text_size(12).text_color(t.dim).child('暂无活动 Agent'))))
      .when(quota,e=>e.child(quota))
      // 拖动捕获层：浮在侧栏最上层、不参与布局，覆盖整个侧栏。
      .when(this.drag,e=>e.child(div().id('drag-layer').absolute().inset(0).w_full().h_full()
        .on_mouse_move((event,cx)=>{if(event.bounds)this.rootBounds=event.bounds;this.moveDrag(event,cx);})
        .on_mouse_up('left',(_e,cx)=>this.finishDrag(cx))
        .on_click((_e,cx)=>cx.stop_propagation())));
  }
}
