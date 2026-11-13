// 原生状态图标；旋转交给 GPU 动画，不使用刷新计时器。
import { div, svg } from 'gpui-kit';
export function statusIcon(state,t) {
  const path='mods/agent-workbench/';
  if(state==='working') return svg(path+'working.svg').size(14).text_color(t.working).spin(1000);
  const icon=state==='blocked'?'attention':state==='done'?'done':'idle';
  return div().size(14).flex_none().items_center().justify_center().child(svg(path+icon+'.svg').size(12).text_color(t[state]??t.dim));
}
