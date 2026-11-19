# verified-main（验证基线）

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `layouts/verified-main.json`; [main](main.md)

定位：与 `main` 结构完全一致，只把标签栏换成 `verified-tabs`，用来和 `main` 并排对照标签行为。
不是日常布局，而是“改动标签相关代码后先在这里确认”的验证基线。

## 区域

| 区域 | 尺寸 | 内容 | 来源 mod |
|---|---|---|---|
| 侧栏品牌位 | 46px | 窗口拖拽区、品牌 | `workspace-chrome`（仓内） |
| 侧栏 Space 段 | 权重 1，最小 90px | Space 列表 | 宿主 `spaces` |
| 侧栏 Agent 段 | 权重 1，最小 90px | Agent 列表 | 宿主 `agents` |
| 侧栏页脚 | 69px | 状态与操作 | `workspace-chrome`（仓内） |
| 标签栏 | 42px | 验证版标签 | 宿主 `verified-tabs` |
| 主区 | 权重撑满 | 终端面板 | 宿主 `pane` |
| 右侧面板 | 368px，最小 280px | 文件 + 变更 | 宿主 `files` / `changes` |
| 状态栏 | 28px | 工作区状态 | 宿主 `workspace-status` |

## 依赖

| mod | 来源 | 作用 |
|---|---|---|
| `workspace-chrome` | 仓内 `mods/` | 品牌位与页脚 |
| `verified-tabs` | 宿主内置 | 标签栏 |
| `spaces` `agents` `pane` `files` `changes` `workspace-status` | 宿主内置 | 其余区域 |

宿主没有 `verified-tabs` 时不要启用；换回 `main` 即可继续使用默认标签。

## 外观

与 `main` 相同：`theme` 未设置（浅色 `paper` / 深色 `graphite`），
`titlebar: none`，`background: canvas`，红绿灯 `[12,16]`，终端内边距 `[14,12]`。

## 启用与回退

```bash
herdr-app do layout.switch --name verified-main
herdr-app status
```

对照流程：同一操作分别在 `main` 与 `verified-main` 下执行，比较标签的创建、重命名、溢出与关闭行为。

## 适用与边界

- 适合：标签相关改动的前后对照、回归确认。
- 不适合：日常开发（用 `agents-order`）或故障回退（用 `main`）。
- 与 `main` 的唯一结构差异就是标签 mod；两边出现布局差异说明有人改了其中一个文件，先对齐再测。
