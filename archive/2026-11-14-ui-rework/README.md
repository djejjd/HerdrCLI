状态: archived
创建: 2026-11-14
最后更新: 2026-11-14
关联: ~/.config/herdr-app/layouts/agent-workbench.json（原布局，未改动）

# UI 改版封存（2026-11-14）

这次改版的全部产物，已从运行环境中撤下，原样封存在这里。

## 内容
- mods/workbench-top        整宽顶栏（Herdr + 分支 + 计数 + Cache）
- mods/workbench-crumb      面包屑（替代标签栏）+ 折叠按钮 + ⋯ 菜单入口
- mods/workbench-terminals  终端条（已并入状态栏，保留代码）
- mods/workbench-status     整宽状态栏（终端/机器/分支/agents）
- mods/workbench-brand      侧栏品牌行
- mods/workbench-footer     侧栏底部（后被移除）
- mods/workbench-more       ⋯ 菜单（Settings / Add machine）
- layouts/agent-workbench-copy.json  克隆布局（root: top + main-row + status）

## 恢复方式
1. 把 `repo-mods/*` 拷回仓库 `mods/`（若需要用 Git 管理）
2. 把 `mods/` 与 `layouts/` 拷回 `~/.config/herdr-app/` 对应目录
3. 重启应用后 `herdr-app do layout.switch --name agent-workbench-copy`

## 目录
- `mods/`      部署版（~/.config/herdr-app/mods 的原样，含 workspace-chrome-edited* 残留）
- `repo-mods/` 仓库版（HerdrCLI/mods 下新增的 7 个 mod + palette.js）
- `layouts/`   克隆布局 agent-workbench-copy.json

## 已还原
- mods/agent-workbench/main.js 已回滚为改版前版本（备份在 HerdrCLI/.tmp/design/backup/agent-workbench.main.js）
