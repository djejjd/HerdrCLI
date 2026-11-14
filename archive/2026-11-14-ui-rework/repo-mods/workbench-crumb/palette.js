// 工作台配色：单一真源。light/dark 两套 token，其它 mod 只读这里。
// 约定：p 为 palette(mode) 的返回值；mode 由顶栏（workspace-chrome）写入 shared("ui.mode")。
export const LIGHT = {
  canvas: '#fbfbfa', surface: '#ffffff', raised: '#f2f2f4',
  line: '#e6e6e9', lineStrong: '#d6d6da',
  ink: '#1d1d1f', muted: '#6e6e73', subtle: '#86868b',
  accent: '#0066cc', ok: '#1a7431', warn: '#96430a', bad: '#d70015',
  selection: '#eef4fd', hover: '#f4f4f6',
};
export const DARK = {
  canvas: '#0b0b0d', surface: '#121214', raised: '#191a1c',
  line: '#26262a', lineStrong: '#33343a',
  ink: '#f5f5f7', muted: '#a1a1a6', subtle: '#8a8f98',
  accent: '#4c8dff', ok: '#34c77b', warn: '#e0a458', bad: '#ff6b6b',
  selection: '#1b2735', hover: '#17181b',
};
export function palette(mode) { return mode === 'dark' ? DARK : LIGHT; }
export function mode(get) {
  try { const v = get?.('ui.mode'); return v === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}
