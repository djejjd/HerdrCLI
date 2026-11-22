// 文件树按 Machine、Space、Agent 分层；单机布局省略机器行。
import { div, svg } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { run, openOverlay, spaces as liveSpaces } from 'herdr';
import { machineProjects, machineNames, machineAction, spaceMove } from './unified-sidebar-index.js';

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
    const group = v_flex().id('space-group-' + s.id).relative().mt(6).flex_none()
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
      .when(open && members.length, el => el.child(v_flex().relative().pl(24)
        .child(div().absolute().left(16).top(4).bottom(16).w(1).bg(t.border))
        .children(drawAgents(members))))
      .when(mark, el => el.child(div().absolute().left(1).right(1).h(2).bg(t.accent)
        .when(drag.after, line => line.bottom(0)).when(!drag.after,line => line.top(0))));
    rows.push(group);
  };
  const active = spaces.find(space => space.active)?.machine ?? null;
  const name = view.selectedMachine === undefined ? active : view.selectedMachine;
  const action = machineAction(name,machineList);
  const options = names.length ? names : [null];
  rows.push(row().id('machine-picker').child(div().flex_1().truncate().font_semibold()
    .when(options.length > 1, el => el.cursor_pointer().on_click((_e,cx) => {
      view.machineMenu = !view.machineMenu;
      cx.notify();
    })).child((name ?? '本机') + (options.length > 1 ? ' ▾' : '')))
    .child(div().id('machine-action').px(6).cursor_pointer().tooltip(action === '+' ? '新建工作区' : '机器设置')
      .on_click(() => action === '+' ? run('space.new',{machine:name ?? ''}) : run('app.settings',{section:'machines'})).child(action)));
  if (view.machineMenu) {
    for (const option of options) rows.push(row().id(keyOf('machine',option)).cursor_pointer()
      .on_click((_e,cx) => {
        view.selectedMachine = option;
        view.machineMenu = false;
        const targets = machineProjects(spaces,option);
        const target = targets.find(space => space.id === view.lastProjects?.get(option)) ?? targets[0];
        view.lastProjects ??= new Map();
        const previous = spaces.find(space => space.active);
        if (previous) view.lastProjects.set(previous.machine ?? null,previous.id);
        run(target ? 'layout.show' : 'layout.hide',{id:'work'});
        if (target) run('space.select',{id:target.id});
        cx.notify();
      }).child(option ?? '本机'));
  }
  const projects = machineProjects(spaces,name);
  projects.forEach(addSpace);
  if (!projects.length) rows.push(div().px(8).text_color(t.dim).child(action === '+' ? '暂无工作区' : '机器未连接'));
  return rows;
}
