// 文件树按 Machine、Space、Agent 分层；单机布局省略机器行。
import { div, svg } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { run, openOverlay, spaces as liveSpaces } from 'herdr';
import { machineNames, spaceMove } from './unified-sidebar-index.js';

const keyOf = (type, id) => JSON.stringify([type,id]);
const chevron = (open, t) => svg('mods/workspace-chrome/chevron-' + (open ? 'down' : 'right') + '.svg')
  .size(12).text_color(t.dim);
const lead = () => h_flex().w(17).h_full().flex_none().items_center().justify_center();
const row = () => h_flex().px(8).gap(7).items_center().h(30).flex_none();
function countLabel(count, t) {
  return div().flex_none().text_size(11).text_color(t.muted).child(count + ' 待处理');
}

export function sidebarRows(t, spaces, machineList, tree, view, drawAgents) {
  const names = machineNames(spaces,machineList.map(m => m.name));
  const rows = [];
  const addSpace = s => {
    const key = keyOf('space',s.id), open = !view.folds.has(key);
    const members = tree.members.get(s.id) ?? [], count = tree.perSpace.get(s.id) ?? 0;
    const drag = view.spaceDrag;
    const mark = drag?.moved && drag.target === s.id;
    const header = row().id('project-' + s.id).h(26).rounded(4)
      .hover(el => el.bg(t.hover))
      .on_mouse_down('right',(_e,cx) => { cx.stop_propagation(); openOverlay({mod:'menu',kind:'popup',width:200,props:{tab:'space',target:{id:s.id,space:s.id}}}); })
      .child(lead().id('fold-' + s.id).when(members.length > 0, el => el.cursor_pointer()
        .on_click((_e,cx) => { cx.stop_propagation(); view.toggle(key,cx); }).child(chevron(open,t))))
      .child(div().id('space-name-' + s.id).h_full().flex().items_center().flex_1().min_w(0).cursor_grab().gap(5)
        .on_mouse_down('left',(e,cx) => {
          view.focusHandle.focus();
          view.spaceDrag = { source:s.id, start:e.position, moved:false, target:null };
          cx.notify();
        })
        .child(svg('mods/workspace-chrome/folder.svg').size(14).flex_none().text_color(t.muted))
        .child(div().truncate().font_semibold().text_size(12)
        .text_color(t.muted).tooltip(s.name).child(s.name)))
      .when(!open && count > 0, el => el.child(countLabel(count,t)));
    const group = v_flex().id('space-group-' + s.id).relative().pl(names.length ? 8 : 0).mt(6).flex_none()
      .on_mouse_move((e,cx) => {
        const d = view.spaceDrag;
        if (!d) return;
        if (!d.moved && Math.hypot(e.position.x-d.start.x,e.position.y-d.start.y) < 5) return;
        const after = e.local_position.y >= e.bounds.height / 2;
        const target = spaceMove(spaces,d.source,s.id,after) ? s.id : null;
        if (d.moved && d.target === target && d.after === after) return;
        Object.assign(d,{moved:true,target,after});
        cx.notify();
      })
      .on_mouse_up('left',(e,cx) => {
        const d = view.spaceDrag;
        if (!d) return;
        view.spaceDrag = null;
        cx.stop_propagation();
        if (d.moved) {
          const after = e.local_position && e.bounds && e.local_position.y >= e.bounds.height / 2;
          const move = spaceMove(liveSpaces(),d.source,s.id,Boolean(after));
          if (move) run('space.move',move);
        } else if (d.source === s.id) run('space.select',{id:s.id});
        cx.notify();
      })
      .when(drag?.moved && drag.source === s.id, el => el.opacity(0.65))
      .child(header)
      .when(open && s.active && s.branch, el => el.child(div().pl(51).pb(2).text_size(11.5).text_color(t.dim)
        .child(s.branch.replace(/([/-])/g,'$1\u200b'))))
      .when(open && members.length, el => el.child(v_flex().pl(24).children(drawAgents(members))))
      .when(mark, el => el.child(div().absolute().left(1).right(1).h(2).bg(t.accent)
        .when(drag.after, line => line.bottom(0)).when(!drag.after,line => line.top(0))));
    rows.push(group);
  };
  if (!names.length) { spaces.forEach(addSpace); return rows; }
  for (const name of names) {
    const key = keyOf('machine',name), open = !view.folds.has(key);
    const count = tree.pending.get(name) ?? 0;
    rows.push(row().id(key).rounded(5).cursor_pointer().hover(el => el.bg(t.hover))
      .on_click((_e,cx) => view.toggle(key,cx))
      .child(lead().child(chevron(open,t)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(name ?? '本机'))
      .when(!open && count > 0, el => el.child(countLabel(count,t)))
      .when(open, el => el.child(div().id('new-' + key).px(4).text_color(t.dim).tooltip('新建工作区')
        .on_click((_e,cx) => { cx.stop_propagation(); run('space.new',{machine:name ?? ''}); }).child('+'))));
    if (!open) continue;
    const projects = spaces.filter(s => (s.machine ?? null) === name);
    projects.forEach(addSpace);
    if (!projects.length) {
      const state = machineList.find(m => m.name === name)?.layout;
      rows.push(div().pl(32).text_size(11.5).text_color(t.dim)
        .child(state === 'loading' ? '载入中…' : (state === 'unavailable' || (name && machineList.some(m => m.name === name && m.state && m.state !== 'connected'))) ? '机器未连接' : '暂无工作区'));
    }
  }
  return rows;
}
