# terminals（纯终端）

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `layouts/terminals.json`

定位：只剩终端的工作区。没有侧栏、没有文件/变更面板，标签由 `terminals-bar` 承担，
主题固定深色 `graphite`，不跟随外观。

## 区域

| 区域 | 尺寸 | 内容 | 来源 mod |
|---|---|---|---|
| 顶部标签条 | 自适应 | 终端标签 | 宿主 `terminals-bar` |
| 主区 | 撑满 | 终端面板 | 宿主 `terminals-pane` |

没有侧栏、右侧面板与状态栏；窗口红绿灯内缩 `[16,18]`，背景固定 `#131619`。

## 依赖

| mod | 来源 | 作用 |
|---|---|---|
| `terminals-bar` | 宿主内置 | 顶部标签条 |
| `terminals-pane` | 宿主内置 | 终端面板 |

全部为宿主内置，仓库 `mods/` 不参与；本布局不含任何仓内 mod。

## 外观

- `theme: graphite`（固定深色，不受 `appearance` 影响）。
- `titlebar: none`，`background: #131619`，未设置 `terminal_padding` 与分隔线。

## 启用与回退

```bash
herdr-app do layout.switch --name terminals
herdr-app status
```

回退到 `main`（原生侧栏 + 标签）或 `agents-order`（文件树侧栏）。

## 适用与边界

- 适合：纯终端作业、临时排障、屏幕窄时最大化终端面积。
- 不适合：需要 Space/Agent 导航、需要看文件变更。
- 它不读取 `mods/`，因此不会受自定义 mod 改动影响，可作为“宿主本身是否正常”的对照布局。
