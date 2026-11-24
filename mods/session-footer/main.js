import {View,div} from 'gpui-kit';
import {h_flex,v_flex,Popover} from 'gpui-base';
import {agents,theme,run,props,focused,terminals,exec,checking,appHome,openOverlay,closeOverlay} from 'herdr';
import {showFooter} from './fee.js';
import {modelReadingKey,quotaSelection,resetLabel} from './model.js';
import {summary} from './summary.js';

const cacheKey = term => term && JSON.stringify([modelReadingKey(term),term.created_ms,term.labels?.['workbench.footer.binding'] ?? '']);
const selectedAddress = () => focused()?.shown ?? focused()?.terminal;

export default class Footer extends View {
  init(_props,cx) {
    this.handle = cx.focus_handle();
    if (props()?.details) { this.handle.focus(); return; }
    this.cards = [];
    this.pending = new Set();
    this.next = new Map();
    try { this.routes = new Map(JSON.parse(localStorage.getItem('fee.sessions.v1') || '[]')); }
    catch { this.routes = new Map(); }
    if (!checking()) this.timer = cx.timer.every(250,ctx => this.refresh(ctx));
  }

  close() { this.closed = true; this.timer?.cancel(); }

  load(cx,address,key,ttl) {
    if (this.pending.has(key) || Date.now() < (this.next.get(key) || 0)) return;
    this.next.set(key,Date.now()+ttl);
    this.pending.add(key);
    cx.spawn(async ctx => {
      try {
        const result = await exec('node',[appHome()+'/mods/session-footer/read.mjs',address,address==='quota'?'quota':'fee'],{timeout:14000});
        if (this.closed || result.code !== 0) return;
        const {cards,route} = JSON.parse(result.stdout);
        if (address==='quota') { if (cards) this.cards=cards; return; }
        if (!route?.sessionId || !route.bill) return;
        this.routes.delete(key);
        this.routes.set(key,route);
        if (this.routes.size>64) this.routes.delete(this.routes.keys().next().value);
        localStorage.setItem('fee.sessions.v1',JSON.stringify([...this.routes]));
      } catch { /* 读取失败时保留该会话最近一次账单。 */ }
      finally { this.pending.delete(key); if (!this.closed) ctx.notify(); }
    });
  }

  refresh(cx) {
    const all=terminals(), address=selectedAddress();
    const current=all.find(term=>term.address===address);
    const visible=showFooter(address,agents(),current?.foreground?.name);
    if (visible!==this.visible) {this.visible=visible; run(visible?'layout.show':'layout.hide',{id:'status'});}
    if (visible && current) this.load(cx,address,cacheKey(current),15000);
    this.load(cx,'quota','quota',30000);
    if (this.pending.size<2) {
      const other=all.find(term=>term.address!==address && !term.labels?.['workbench.child.kind'] &&
        showFooter(term.address,[],term.foreground?.name) && !this.routes.has(cacheKey(term)) &&
        !this.pending.has(cacheKey(term)) && Date.now()>=(this.next.get(cacheKey(term)) || 0));
      if (other) this.load(cx,other.address,cacheKey(other),60000);
    }
  }

  detail(data) {
    const colors=theme();
    const panel=v_flex().w(240).p(12).gap(8).rounded(8).bg(colors.popover).text_size(13).text_color(colors.foreground);
    const line=(label,value)=>h_flex().gap(12).items_center().child(div().flex_1().text_color(colors.muted).child(label)).child(div().child(value));
    panel.child(line('本会话',data.fee.replace(/^本会话 /,'')));
    const amounts=(data.bill?.children || []).map(child=>child.amount).filter(Number.isFinite);
    if (amounts.length) panel.child(line('其中子 Agent','$'+amounts.reduce((sum,value)=>sum+value,0).toFixed(2)));
    if (data.bill?.pending) panel.child(div().child('还有 '+data.bill.pending+' 笔费用待计入'));
    if (data.bill?.partial) panel.child(div().child('部分子任务费用待核对'));
    for (const reading of data.readings) {
      const reset=resetLabel(reading.reset);
      panel.child(line(reading.label,reading.value+(reset?'　'+reset+' 重置':'')));
    }
    return panel;
  }

  render() {
    if (props()?.details) return this.detail(props().details);
    const term=terminals().find(item=>item.address===selectedAddress());
    const route=this.routes.get(cacheKey(term));
    const account=quotaSelection(this.cards,route?.provider,route?.account).current;
    const card=route?.keyCard ?? (account?.kind==='subscription' ? account : null);
    const data={...summary(route?.bill,card),bill:route?.bill};
    const colors=theme();
    const row=h_flex().size_full().px(14).gap(8).items_center().text_size(12).bg(colors.chrome).text_color(colors.muted);
    row.child(div().truncate().child(route?.model || term?.report?.model || ''));
    if (term?.labels?.['workbench.child.kind']) return row;
    if (!data.line) return row;
    const trigger=div().id('session-cost').rounded(4).px(5).tab_stop(true).tab_index(0)
      .cursor_pointer().tooltip('查看费用').hover(style=>style.bg(colors.selected)).child(data.line);
    return row.child(Popover.new('session-fee-popover').anchor('bottom_left').trigger(trigger).content(this.detail(data)));
  }
}
