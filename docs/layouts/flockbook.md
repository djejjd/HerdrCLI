# flockbook（本机专有）

状态: active
创建: 2026-11-19
最后更新: 2026-11-19
关联: `~/.config/herdr-app/layouts/flockbook.json`; 宿主机 `flockbook` mod

定位：Flockbook 单色风格外壳。只存在于这台机器的运行目录，**未入仓**，仓库里也没有 `flockbook` mod，
换机器无法从本仓库复现；本文只登记它是什么、依赖什么，避免他人把它当成仓内布局。

## 区域

| 区域 | 尺寸 | 内容 | 来源 mod |
|---|---|---|---|
| 整套外壳 | 撑满 | 单色风格窗口、侧栏、标签的容器 | 宿主机 `flockbook` |

没有可拆的独立区域：布局里只引用一个 `flockbook` mod，由它接管整体外观。

## 依赖

| mod | 来源 | 作用 |
|---|---|---|
| `flockbook` | 宿主机 `~/.config/herdr-app/mods/` | 整体外观 |

仓库 `mods/` 不含该 mod，CI 或新机器无法据此复现。

## 外观

- `theme: { light: flockbook-light, dark: flockbook }`，随 `appearance` 切换。
- `titlebar: none`，`background: canvas`。

## 启用与回退

```bash
herdr-app do layout.switch --name flockbook
herdr-app status
```

回退：切回 `agents-order`（日常）或 `main`（原生）。本布局不写仓内 mod，回退无需清理文件。

## 适用与边界

- 适合：本机上的单色风格试验。
- 不适合：需要跨机器复现、需要仓库内可追溯的场景。
- 若要让其他人使用，需要先把 `flockbook` mod 与布局 JSON 收进 `mods/` 与 `layouts/`，
  再按 [README](README.md) 的维护流程补一份正式布局文档。
