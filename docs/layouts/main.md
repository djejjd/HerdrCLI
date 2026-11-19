# main（上游默认）

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `layouts/main.json`; `docs/operations/restore-layout.md`

定位：上游默认布局，也是出问题时的回退基准。侧栏分 `spaces` 与 `agents` 两段，标签用宿主 `tabs`，
除 `workspace-chrome` 外全部依赖宿主内置 mod，依赖面最小。

## 区域

| 区域 | 尺寸 | 内容 | 来源 mod |
|---|---|---|---|
| 侧栏品牌位 | 46px | 窗口拖拽区、品牌 | `workspace-chrome`（仓内） |
| 侧栏 Space 段 | 权重 1，最小 90px | Space 列表 | 宿主 `spaces` |
| 侧栏 Agent 段 | 权重 1，最小 90px | Agent 列表 | 宿主 `agents` |
| 侧栏页脚 | 69px | 状态与操作 | `workspace-chrome`（仓内） |
| 标签栏 | 42px | 横向标签 | 宿主 `tabs` |
| 主区 | 权重撑满 | 终端面板 | 宿主 `pane` |
| 右侧面板 | 368px，最小 280px | 文件 + 变更 | 宿主 `files` / `changes` |
| 状态栏 | 28px | 工作区状态 | 宿主 `workspace-status` |

侧栏宽 268px（`min 44 / max 480`）。

## 依赖

| mod | 来源 | 作用 |
|---|---|---|
| `workspace-chrome` | 仓内 `mods/` | 品牌位与页脚 |
| `spaces` `agents` `tabs` `files` `changes` `pane` `workspace-status` | 宿主内置 | 其余全部区域 |

## 外观

- `theme` 未设置 → 浅色 `paper`，深色 `graphite`。
- `titlebar: none`，`background: canvas`，红绿灯 `[12,16]`，终端内边距 `[14,12]`，分隔线 1px `border`。

## 启用与回退

```bash
rsync -a layouts/ ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name main
herdr-app status
```

从 `agents-order` 回退到本布局后，侧栏恢复为 Space + Agent 两段，标签恢复宿主默认行为。

## 适用与边界

- 适合：故障回退、与自定义布局做对照、只想要上游行为。
- 不适合：需要文件树侧栏、标签溢出下拉（改用 `agents-order`）。
- 与 `verified-main` 的差别只在标签 mod（`tabs` vs `verified-tabs`）。
