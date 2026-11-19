# agent-workbench（工作台）

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `layouts/agent-workbench.json`; `mods/agent-workbench/`; `mods/workbench-*`; `archive/2026-11-14-ui-rework/`

定位：工作台式布局。侧栏是单段 Agent 列表（不带 Space 分段），标签用 `workbench-tabs`，
主区分栏里带独立终端面板，右侧固定文件/变更面板，并挂 `notify` 通知。

## 区域

| 区域 | 尺寸 | 内容 | 来源 mod |
|---|---|---|---|
| 侧栏品牌位 | 46px | 窗口拖拽区、品牌 | `workspace-chrome`（仓内） |
| 侧栏 Agent 段 | 权重 1，最小 90px | 单段 Agent 列表 | `agent-workbench`（仓内） |
| 侧栏页脚 | 69px | 状态与操作 | `workspace-chrome`（仓内） |
| 标签栏 | 42px | 工作台标签 | `workbench-tabs`（仓内） |
| 主区 | 权重撑满 | 终端面板 | `workbench-pane`（仓内） |
| 右侧面板 | 368px，最小 280px | 文件 + 变更 | 宿主 `files` / `changes` |
| 状态栏 | 28px | 工作区状态 | 宿主 `workspace-status` |
| 通知 | 浮层 | toast | `notify` / `notify-toast`（仓内） |

侧栏宽 268px（`min 240`，比 `main` / `agents-order` 的下限高）。

## 依赖

| mod | 来源 | 作用 |
|---|---|---|
| `agent-workbench` | 仓内 `mods/` | 单段 Agent 侧栏 |
| `workbench-tabs` | 仓内 `mods/` | 标签栏 |
| `workbench-pane` | 仓内 `mods/` | 终端面板 |
| `notify` `notify-toast` | 仓内 `mods/` | 通知与 toast；`notify-toast` 由布局根部的 `toast` 键绑定，不是区块 |
| `workspace-chrome` | 仓内 `mods/` | 品牌位与页脚 |
| `files` `changes` `workspace-status` | 宿主内置 | 右侧面板与状态栏 |

仓内依赖最多，缺任一 mod 都会让对应区域或通知失效，启用前先 `rsync -a mods/`。

## 外观

- `theme` 未设置 → 浅色 `paper` / 深色 `graphite`。
- `titlebar: none`，`background: canvas`，红绿灯 `[12,16]`，终端内边距 `[14,12]`，分隔线 1px `border`。

## 启用与回退

```bash
rsync -a mods/ ~/.config/herdr-app/mods/
rsync -a layouts/ ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name agent-workbench
herdr-app status
```

回退：切到 `main` 或 `agents-order`。`archive/2026-11-14-ui-rework/` 里的
`agent-workbench-copy` 是本布局的改版复刻，属于封存物，不作日常使用。

## 适用与边界

- 适合：需要固定右侧文件/变更面板、需要工作台分栏与通知的场景。
- 不适合：只想看 Space 分组（用 `agents-order` / `main`）、依赖面要最小（用 `main`）。
- 侧栏不再按 Space 分段，Space 的层级信息只体现在 Agent 命名与标签上。
