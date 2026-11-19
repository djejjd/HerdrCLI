# 布局目录

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `layouts/`; `docs/operations/restore-layout.md`; `archive/2026-11-14-ui-rework/`

目的：把每套布局当作一个整体交付——区域划分、依赖 mod、外观来源、启用方式、适用边界都写在同一页，
换人或换机器时不必再去读 JSON 猜结构。每套布局一份文件，本页只做索引与选型。

## 一、总表

| 布局 | 形态 | 侧栏 | 标签栏 | 右侧面板 | 外观 | 仓库内依赖 | 适合 |
|---|---|---|---|---|---|---|---|
| [agents-order](agents-order.md) | 树形侧栏 + 溢出标签 | 文件树（机器/Space/Agent） | `compact-tabs` | 文件 + 变更 | `paper`/`graphite` | `agents-order` `compact-tabs` `compact-spaces` `workspace-chrome` | 日常开发，当前启用 |
| [main](main.md) | 上游默认 | `spaces` + `agents` 两段 | `tabs` | 文件 + 变更 | `paper`/`graphite` | `workspace-chrome` | 回退、对照基准 |
| [verified-main](verified-main.md) | 同 `main`，标签换验证版 | `spaces` + `agents` | `verified-tabs` | 文件 + 变更 | `paper`/`graphite` | `workspace-chrome` | 标签行为对照验证 |
| [agent-workbench](agent-workbench.md) | 工作台式 | `agent-workbench` 单段 | `workbench-tabs` | 文件 + 变更 | `paper`/`graphite` | `agent-workbench` `workbench-tabs` `workbench-pane` `notify` `notify-toast` `workspace-chrome` | 需要工作台式分栏 |
| [terminals](terminals.md) | 纯终端 | 无 | `terminals-bar` | 无 | `graphite`（固定深色） | 无（全为宿主内置） | 只要终端、不要侧栏 |
| [win98](win98.md) | 主题外壳 | 由外壳承担 | 由外壳承担 | 由外壳承担 | `win98`（`#008080`） | 无（宿主内置） | 主题试验，不作日常 |
| [flockbook](flockbook.md) | 主题外壳 | 由外壳承担 | 由外壳承担 | 由外壳承担 | `flockbook` / `flockbook-light` | 无（**未入仓**，本机专有） | 单色风格试验 |

## 二、切换

```bash
# 1. 先把仓库里的 mod 与布局同步到运行目录
rsync -a mods/   ~/.config/herdr-app/mods/
rsync -a layouts/ ~/.config/herdr-app/layouts/

# 2. 切换
herdr-app do layout.switch --name agents-order

# 3. 看结果；errors 应为 []
herdr-app status
```

等价做法：改 `~/.config/herdr-app/shared.json` 的 `layout` 字段后重载应用。
`herdr-app do layout.switch` 会同时更新该字段，优先用它，避免手改漏项。

## 三、依赖分两层

| 层 | 位置 | 说明 |
|---|---|---|
| 仓内 mod | `mods/` → `~/.config/herdr-app/mods/` | 随仓库分发，`rsync` 后可用 |
| 宿主内置 mod | 仅 `~/.config/herdr-app/mods/`，不在仓库 | `spaces` `agents` `tabs` `verified-tabs` `files` `changes` `pane` `workspace-status` `terminals-bar` `terminals-pane` `win98` `flockbook` 等 |

布局引用的 mod 只要有一层缺失，就视为前提不满足：不要启用，先补齐或改用其他布局。
仓库 `mods/` 只覆盖仓内那 10 个（`agent-workbench` `agents-order` `compact-spaces` `compact-tabs`
`notify` `notify-toast` `workbench-menu` `workbench-pane` `workbench-tabs` `workspace-chrome`），
单靠仓库无法复现依赖宿主内置 mod 的布局。

## 四、本机专有（未入仓）

| 文件 | 说明 |
|---|---|
| `~/.config/herdr-app/layouts/flockbook.json` | 单色风格外壳，仓库无对应 mod，无法从仓库复现 |
| `~/.config/herdr-app/layouts/agent-workbench-copy.json` | 2026-11-14 UI 改版复刻（`agent-workbench` + `agent-plans`），见 `archive/2026-11-14-ui-rework/README.md` |

## 五、选型建议

- 日常开发：`agents-order`——侧栏是文件树，标签溢出可点选，右侧常驻文件与变更。
- 出问题回退：`main`——只用宿主内置 mod，依赖最少。
- 改标签行为：`verified-main` 与 `main` 并排对照。
- 需要固定右侧面板做工作台：`agent-workbench`。
- 只开终端：`terminals`。
- 主题试验：`win98`、`flockbook`，不要作为日常布局。

## 六、维护

- 新增布局：在 `layouts/` 落 JSON，并在本目录补一份同名 `.md`，同时更新本页总表。
- 布局改动后同步更新对应文件里的「区域」「依赖」两节；只改外观时更新「外观」一节。
- 本页与 `docs/operations/restore-layout.md` 分工：本页讲“有哪些、怎么选”，恢复文档讲“怎么找回旧布局”。
