# agents-order（当前启用）

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `layouts/agents-order.json`; `mods/agents-order/`; `mods/compact-tabs/`; `mods/compact-spaces/`

定位：树形侧栏 + 溢出标签的日常开发布局。侧栏按机器 → Space → Agent 分层，标签放不下时收进下拉，
右侧常驻文件与变更面板。当前 `shared.json` 的 `layout` 指向它。

## 区域

| 区域 | 尺寸 | 内容 | 来源 mod |
|---|---|---|---|
| 侧栏品牌位 | 46px | 窗口拖拽区、品牌 | `workspace-chrome`（仓内） |
| 侧栏主体 | 权重 1，最小 90px | 文件树：机器行 / Space 文件夹 / Agent 缩进 / Space 拖动 | `agents-order`（仓内，`props.tree=true`） |
| 侧栏页脚 | 69px | 状态与操作 | `workspace-chrome`（仓内，`props.footer`） |
| 标签栏 | 42px | 单行横向标签，按宽度溢出下拉 | `compact-tabs`（仓内） |
| 主区 | 权重撑满 | 终端面板 | 宿主 `pane` |
| 右侧面板 | 368px，最小 280px | 文件 + 变更 | 宿主 `files` / `changes` |
| 状态栏 | 28px | 工作区状态 | 宿主 `workspace-status` |

侧栏宽 268px（`min 44 / max 480`，不可拖）。树内折叠状态、Space 拖动顺序、标签宽度测量都由
`agents-order` + `compact-tabs` 承担；`compact-spaces` 不占区域，只在「管理」弹窗里出现。

## 依赖

| mod | 来源 | 作用 |
|---|---|---|
| `agents-order` | 仓内 `mods/` | 侧栏树、待办行内状态、改名 |
| `compact-tabs` | 仓内 `mods/` | 标签溢出与下拉 |
| `compact-spaces` | 仓内 `mods/` | 机器 / Space 管理弹窗 |
| `workspace-chrome` | 仓内 `mods/` | 品牌位与页脚 |
| `files` `changes` `pane` `workspace-status` | 宿主内置 | 右侧面板、终端、状态栏 |

## 外观

- `theme` 未设置 → 浅色用 `paper`，深色用 `graphite`。
- `titlebar: none`，`background: canvas`，红绿灯内缩 `[12,16]`，终端内边距 `[14,12]`，分隔线 1px `border`。

## 启用与回退

```bash
rsync -a mods/ ~/.config/herdr-app/mods/
rsync -a layouts/ ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name agents-order
herdr-app status   # errors: []
```

回退到 `main` 布局即可复原原生 `spaces` + `agents` 两段侧栏；旧布局找回见
`docs/operations/restore-layout.md`。

## 适用与边界

- 适合：日常开发、需要看文件/变更、Space 与 Agent 数量多。
- 不适合：不需要侧栏（改用 `terminals`）、只想要上游原样（改用 `main`）。
- 单机（无远程机器）时侧栏不出现机器行，新建 Space 从「管理」弹窗进入。
- 依赖仓内 4 个 mod；缺少任一 mod 时不要启用，先 `rsync` 补齐。
