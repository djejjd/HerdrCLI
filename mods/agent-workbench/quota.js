// 额度纯逻辑：解析快照与控制异步竞态；不读对话正文，不碰凭据。
export function remaining(used) {
  if(typeof used!=='number'||!Number.isFinite(used)||used<0||used>100) return null;
  return Math.round(100-used);
}
export function windowLabel(minutes) {
  if(typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<=0) return null;
  if(minutes>=10080&&minutes%10080===0) return minutes===10080?'周':`${minutes/10080}周`;
  if(minutes>=1440&&minutes%1440===0) return `${minutes/1440}天`;
  return Math.round(minutes/60)+'h';
}
function oneWindow(w) {
  if(!w) return null;
  const left=remaining(w.used_percent), label=windowLabel(w.window_minutes);
  if(left===null||!label) return null;
  const resetsAt=Number(w.resets_at);
  return {label,remaining:left,resetsAt:Number.isFinite(resetsAt)&&resetsAt>0?resetsAt:null};
}
// rate_limits 快照；字段不合法就返回 unknown，不猜。
export function parseCodexQuota(record, now=null) {
  const primary=oneWindow(record?.primary), secondary=oneWindow(record?.secondary);
  if(!primary&&!secondary) return {status:'unknown',reason:'额度字段缺失'};
  return {status:'ready',primary,secondary,plan:typeof record?.plan_type==='string'?record.plan_type:null,snapshotAt:now};
}
// 只有“focused 是 live 终端且该终端就是 Agent”才产出目标；身份不足给 null。
export function pickQuotaTarget(f, terminalList, agentList, paneList=[]) {
  if(!f?.terminal||!f?.agent) return null;
  // focused 指向具名 pane 时，确认它确实是显示该终端的 pane，而不是 Files 等 mod pane。
  if(f.pane){
    const pane=paneList.find(p=>p.pane===f.pane);
    if(!pane||pane.terminal!==f.terminal) return null;
  }
  const term=terminalList.find(t=>t.address===f.terminal);
  const agent=agentList.find(a=>a.address===f.agent);
  if(!term||!agent||term.state!=='live'||agent.address!==f.terminal) return null;
  const program=agent.program?.key;
  if(!['codex','claude','opencode','dsh-tui'].includes(program)) return null;
  // 额度与恢复身份解耦：只需要当前终端进程，账号绑定在额度解析里做。
  const pid=term.foreground?.pid;
  return {program,address:f.terminal,id:pid?String(pid):null};
}
export function quotaKey(identity) {
  return identity ? `${identity.program}:${identity.id ?? 'unknown'}` : null;
}
// 账号绑定与新鲜度：纯逻辑，便于测试失败分支。
export function sessionHome(path) {
  const i = !path ? -1 : path.indexOf('/sessions/');
  return i > 0 ? path.slice(0, i) : null;
}
export function matchAccount(files, authAccount, configProvider) {
  const matched = files.filter(f => f.meta?.creator_account_id && authAccount && f.meta.creator_account_id === authAccount);
  if (!matched.length) return {status:'unknown', reason:'账号归属无法确认'};
  if (matched.some(f => !f.meta?.model_provider)) return {status:'unknown', reason:'provider 缺失'};
  const providers = new Set(matched.map(f => f.meta.model_provider));
  if (providers.size !== 1) return {status:'unknown', reason:'provider 不一致'};
  const provider = [...providers][0];
  if (configProvider && provider !== configProvider) return {status:'unknown', reason:'provider 与当前配置不一致'};
  return {status:'ok', provider, files: matched};
}
export function pickFresh(candidates, now, maxAgeMs = 60*60*1000) {
  const fresh = candidates.filter(c => typeof c.snapshotAt === 'number' && c.snapshotAt > 0 && now - c.snapshotAt >= 0 && now - c.snapshotAt <= maxAgeMs);
  if (!fresh.length) return {status:'unknown', reason:'额度快照过旧'};
  fresh.sort((a,b) => b.snapshotAt - a.snapshotAt);
  if (fresh.length > 1 && fresh[0].snapshotAt === fresh[1].snapshotAt) return {status:'unknown', reason:'多个同新快照，无法判定'};
  return {status:'ok', snapshot: fresh[0]};
}
// 只按可靠身份键控；身份不足直接 unknown，不选 latest。
export class QuotaController {
  constructor({load,now=Date.now,ttlMs=30000,onChange=()=>{}}) {
    this.load=load;this.now=now;this.ttlMs=ttlMs;this.onChange=onChange;
    this.gen=0;this.key=null;this.cache=new Map();this._state={status:'idle'};
    this.stateAt=0;this.lastReady=null;this.lastReadyKey=null;
  }
  get state(){return this._state;}
  get stateKey(){return this.key;}
  setTarget(identity) {
    const key=quotaKey(identity);
    if(key===null){
      if(this.key===null) return false;
      this.key=null;this.lastReady=null;this.lastReadyKey=null;this.gen++;this._set({status:'idle'});return true;
    }
    const cached=this.cache.get(key),fresh=cached&&this.now()-cached.at<this.ttlMs;
    // 同一身份：加载中或缓存新鲜都不重复读取；过期才重读。
    if(key===this.key&&(this._state.status==='loading'||fresh)) return false;
    if(key!==this.key){this.lastReady=null;this.lastReadyKey=null;}
    this.key=key;const gen=++this.gen;
    if(fresh){this._set(cached.state);return true;}
    if(!identity.id){this._set({status:'unknown',reason:'身份不足'});return true;}
    this._set({status:'loading'});
    let p;
    try{p=this.load(identity);}catch(err){this._set({status:'error',reason:String(err?.message??err??'读取失败')});return true;}
    this.pending=Promise.resolve(p).then(
      res=>{if(gen===this.gen)this._set(res);},
      err=>{if(gen===this.gen)this._set({status:'error',reason:String(err?.message??err??'读取失败')});},
    );
    return true;
  }
  clear(){this.key=null;this.lastReady=null;this.lastReadyKey=null;this.gen++;this._set({status:'idle'});}
  close(){this.gen++;this.key=null;this.lastReady=null;this.lastReadyKey=null;this._state={status:'idle'};}
  _set(state){
    this._state=state;this.stateAt=this.now();
    if(state.status==='ready'){this.lastReady=state;this.lastReadyKey=this.key;}
    // loading 不进缓存：切走再切回时要重新发起，不能恢复成永久 loading。
    if(this.key&&state.status!=='loading')this.cache.set(this.key,{at:this.now(),state});
    this.onChange();
  }
}
