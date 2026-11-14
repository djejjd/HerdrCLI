# 布局安装与恢复

状态: active
创建: 2026-11-14
最后更新: 2026-11-14
关联: archive/2026-11-14-ui-rework/; layouts/

目的：换布局后还能找回旧布局。本文给出「当前布局」与「封存的改版布局」两条恢复路径，以及哪些文件留在本地不入库。

## 一、文件在哪

| 内容 | 仓库位置 | 运行位置 |
|---|---|---|
| mod 源码 | `mods/` | `~/.config/herdr-app/mods/` |
| 布局 JSON | `layouts/` | `~/.config/herdr-app/layouts/` |
| 封存的 UI 改版 | `archive/2026-11-14-ui-rework/` | 按需拷回上面两处 |
| 安装脚本 | `scripts/`（见仓库 README） | — |

`layouts/` 里各文件用途：

- `agent-workbench.json` — 当前使用的布局（root: 侧栏 + 主区）
- `main.json` / `terminals.json` — 上游默认与终端视图
- `win98.json` / `win98.svg` — 试验主题
- `verified-main.json` — 验证过的基线副本

## 二、恢复「当前布局」

1. 同步仓库到目标提交：
   ```bash
   cd ~/Code/HerdrCLI && git checkout main && git pull --ff-only
   ```
2. 拷 mod 与布局：
   ```bash
   rsync -a mods/ ~/.config/herdr-app/mods/
   rsync -a layouts/ ~/.config/herdr-app/layouts/
   ```
3. 切换并检查：
   ```bash
   herdr-app do layout.switch --name agent-workbench
   herdr-app status          # 期望 errors: []
   herdr-app check mods/workbench-tabs mods/agent-workbench
   ```

## 三、恢复「已封存的 UI 改版」（workbench-top/crumb/status 那一套）

```bash
cd ~/Code/HerdrCLI/archive/2026-11-14-ui-rework
rsync -a repo-mods/ ~/Code/HerdrCLI/mods/          # 需要纳入 git 时
rsync -a mods/ ~/.config/herdr-app/mods/
rsync -a layouts/ ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name agent-workbench-copy
```

封存说明见 `archive/2026-11-14-ui-rework/README.md`；`*.d.ts` 未入库，`herdr-app check` 会按需重建。

## 四、切换回去之后

- 当前布局的 mod 代码仍在 `mods/`，切回 `agent-workbench` 布局即可复原
- 若改版布局覆盖了同名 mod（如 `workspace-chrome`），以 `git status` 为准，用 `git checkout -- mods/` 还原

## 五、不入库（留在本地）

| 文件 | 原因 |
|---|---|
| `~/.config/herdr-app/keys.json` | 个人键位 |
| `~/.config/herdr-app/settings.json` | 个人偏好（缩放、声音、字体） |
| `~/.config/herdr-app/shared.json` | 运行态（打开请求、账本快照） |
| `~/.config/herdr-app/data/` | 插件私有数据与最近会话 |
| `~/.config/herdr-app/telemetry/`、`*.log` | 运行日志与用量 |
| `docs/quality/`、`.tmp/` | 排障材料（仓库 .gitignore 已排除） |

需要复现键位时，从 `keys.json` 复制 `global` / `terminal` 两段即可；仓库不含任何凭据。

## 六、常见问题

- **切换后白屏/红条**：先 `herdr-app status` 看 `errors`；多半是布局引用的 mod 没拷过去，或 mod 版本不匹配，按第一节两处路径补拷。
- **切回后行为不对**：确认 `~/.config/herdr-app/mods/` 与 `mods/` 的对应文件一致（`cmp` 或 `shasum`），部署目录和仓库不同步是常见原因。
