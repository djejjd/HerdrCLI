// 悬停覆盖式窗格控制：不占用终端行高；多窗格保留最少识别信息。
import { View, div, svg } from 'gpui-kit';
import { h_flex } from 'gpui-base';
import { panes, props, theme, run } from 'herdr';
import { statusIcon } from './status.js';
export default class Pane extends View {
  render() {
    const p=panes().find(p=>p.pane===props().pane); if(!p)return div();
    const t=theme(),many=panes().filter(x=>x.tab===p.tab).length>1;
    const control=(id,icon,command,args)=>div().id(id).p(3).rounded(6).text_color(t.muted)
      .hover(e=>e.bg(t.hover).text_color(t.foreground)).tooltip(icon)
      .on_click((_e,cx)=>{cx.stop_propagation();run(command,{pane:p.pane,...args});})
      .child(svg(`mods/pane/${icon}.svg`).size(14));
    return h_flex().size_full().px(8).gap(4).items_center().bg(t.surface).text_size(11.5)
      .when(many,e=>e.child(div().text_color(t.muted).child(`${p.program?.name??'终端'} · ${p.cwd?.split('/').pop()??''}`)))
      .child(div().flex_1()).child(statusIcon(p.status,t))
      .child(control('split-r','split-right','pane.split',{direction:'right'}))
      .child(control('split-d','split-down','pane.split',{direction:'down'}))
      .when(many,e=>e.child(control('zoom',p.zoomed?'unzoom':'zoom','pane.zoom',{})));
  }
}
