// 用 Herdr 视图 fixture 验证读取进程的阶段摘要经过底栏弹窗渲染。
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';

const state = {address:'t1', next:null, overlay:null};
globalThis.magpieViewFixture = state;
const ui = `
  const state = globalThis.magpieViewFixture;
  export class View {}
  function node() {
    const element = {children:[], click:null};
    const proxy = new Proxy(element, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'child') return child => { target.children.push(child); return proxy; };
        if (key === 'when') return (condition, change) => { if (condition) change(proxy); return proxy; };
        if (key === 'on_click') return click => { target.click = click; return proxy; };
        return () => proxy;
      },
    });
    return proxy;
  }
  export const div = node, svg = node, h_flex = node, v_flex = node;
  export const spaces = () => [], agents = () => [], theme = () => ({}), keys = () => [], run = () => {};
  export const props = () => ({}), checking = () => true, window = () => null, appHome = () => '/fixture';
  export const focused = () => ({terminal:state.address});
  export const terminals = () => [{address:'t1',foreground:{pid:1}}, {address:'t2',foreground:{pid:2}}];
  export const exec = async () => state.next;
  export const openOverlay = overlay => { state.overlay = overlay; };
`;
const uiUrl = 'data:text/javascript,' + encodeURIComponent(ui);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(name, context, next) {
    if (['herdr', 'gpui-base', 'gpui-kit'].includes(name)) return {url:${JSON.stringify(uiUrl)}, shortCircuit:true};
    return next(name, context);
  }
`));

const {default:WorkspaceStatus} = await import('../mods/magpie-status/main.js');

function shownText(node) {
  if (typeof node === 'string') return node;
  return node.children.flatMap(shownText);
}

test('弹窗显示额度与当前终端的失败阶段，保留旧额度且不会转述未经识别的内容', async () => {
  const widget = new WorkspaceStatus();
  const pending = [];
  const cx = {spawn:async fn => pending.push(fn(cx)), notify() {}};
  const open = () => {
    widget.quotaButton({}).click();
    return shownText(widget.detailPanel({}, state.overlay.props.details)).join(' ');
  };
  const refresh = async snapshot => {
    state.next = {code:0, stdout:JSON.stringify(snapshot)};
    widget.nextRead = 0;
    widget.refresh(cx);
    await pending.pop();
  };
  widget.init({}, cx);
  const route = {model:'gpt-fixture', provider:'codex', account:'fixture-account'};
  await refresh({cards:[{provider:'codex', user:'fixture-account', windows:[{name:'5 hours', remaining:42}]}],
    route, failures:[]});
  await refresh({cards:null, route, failures:[
    {stage:'quota', reason:'timeout'}, {stage:'route', reason:'invalid-response'},
    {stage:'unknown', reason:'private.example/token'}, {stage:'session', reason:'another-private-token'},
  ]});
  assert.match(open(), /42%.*额度读取超时.*路由响应无效/);
  assert.doesNotMatch(open(), /private|token/);
  state.address = 't2';
  assert.match(open(), /额度读取超时/);
  assert.doesNotMatch(open(), /路由响应无效/);
  state.next = {code:1, stderr:'private-token'};
  widget.refresh(cx);
  await pending.pop();
  assert.match(open(), /额度读取进程失败/);
  assert.doesNotMatch(open(), /private|token/);
});
