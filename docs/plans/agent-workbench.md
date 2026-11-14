状态: implemented
创建: 2026-11-13
最后更新: 2026-11-14
关联: ../adr/0002-Agent工作台与会话恢复.md

# Agent 工作台实施计划

目标：实现按 Space 分组、共享任务名与顺序、拖动动效、最近会话和尽力恢复。
技术：Herdr gpui-shell JavaScript、herdr-core 标签、Node 原生测试。
设计来源：关联 ADR 与用户确认的浅色样图。

## 文件与任务
- [x] `mods/agent-workbench/model.js`：名称、排序、会话状态；先补 `tests/model.test.mjs` 并运行失败测试。
- [x] `mods/agent-workbench/main.js`：原生工作台、拖动、重命名、会话操作；标签写入失败保留原状态。
- [x] `mods/agent-workbench/status.js` 与 SVG：统一状态和原生圆环动画。
- [x] `mods/workbench-pane/main.js`：精简标题与悬停控制；布局 header 使用 hover，不改变终端尺寸。
- [x] `scripts/install.mjs`：部署个人 mod 和布局，防止覆盖外部修改。
- [x] 运行 Node 测试、全部 mod check、Herdr 状态与截图验证。

## 检查重点
同名、远程地址、同步失败、拖出 Space、重复恢复、原会话仍在运行、目录失效。
Agent 会话身份无法可靠验证时直接给出原因与新建入口，不冒充恢复成功。
终态释放锁和拖动状态；日志不得含对话正文或凭据。

## 设计契约
侧栏沿用 268px，可缩为原有窄栏；任务行 42px、间距 4px，主标题 12.5px，程序 11px；Space 头 24px、项目名 12px、branch 11px；工作台标题 12.5px；最近会话标题 12px、主行 12.5px。
UI-01 前台视觉（2026-11-14）：tab 30px/12.5、顶栏 px12/gap4、active 用 selected 底+底 2px accent；pane 11.5；chrome brand 13/footer 12.5；menu row 30/12.5。颜色只用 theme；不改布局与交互。
行首 30px 隐形热区（含程序图标，图标在热区内居中；不再有可见六点）是唯一拖动入口：图标与文字因此左移，编辑笔/状态/文字不触发拖动。热区 cursor_grab，持续悬停 600ms 才显示「按住拖动排序」，离开、按下或开始拖动立即收起；按下即进入抓取态，不设长按门槛。
按下热区时卡片 48px、左右外扩 2px、上移 3px（保持中心），常态透明边框按下变 accent，shadow 2xl + selected，100ms 反馈；拖动行 top 即时跟随，其他行 160ms 让位；松手或取消 100ms 收回。
热区按下后位移不超过 4px 按单击处理，聚焦该 Agent、不写顺序标签；超过阈值才重排并抑制 click。
按住期间以 16ms 轮询原生指针位置驱动（本组件当前实现的取值，不作为其他组件的统一规范；move 事件不作为唯一依据），指针离开侧栏按坐标兜底取消。
列表独立滚动，Space 分组折叠；最近会话不按 Space 分组，全局一段默认 8 条、可展开全部。空状态、加载、同步错误均有短中文提示。
最近会话整行点击恢复；失败项保留原因，只有显式「新建对话」入口，处理中防重复点击。
拖动中松手、Esc、窗口失焦或指针离开侧栏都清理拖动层；只允许同一 Space 内排序，跨 Space 只夹紧源组目标。
行跟随指针（拖动位移换目标行），其他行 top 过渡 160ms；工作圆环原生 spin 1000ms。
颜色与字体取现有 theme；原品牌图标不重画。
原生桌面验收使用 herdr-app shot 代替浏览器。

折叠箭头：Space 分组与最近会话共用 12×12 chevron SVG，放在固定 12px flex 槽位；展开/折叠同一槽位，不用文字字形。
合并导航：侧栏只有一份工作台列表（不再有独立 Spaces 块），顶部唯一“工作台 +”标题行；项目头 26px，左 18px 折叠区、中间名字区选中 Space、右侧悬停“⋯”开官方 Space 菜单（新建/改名/关闭走官方确认，不自动关闭）；空或仅 shell 的 Space 仍列出、可点进，下面一行 10.5px「无 Agent」提示（会占一行）。
额度栏：侧栏底部固定 footer（min-height 56、px10/py8、上边框 1px），只显示当前 focused pane 上的 Agent；该 pane 不是 live 终端（shell、Files 等 mod pane）时整块不渲染。只展示账户额度，不混入会话费用/token。
额度状态：idle（无 Agent）→ loading（有可靠身份）→ ready / unknown / error；ready 的快照超过 1 小时按 unknown 处理，超过 10 分钟标注快照时间。未知/加载/失败不显示任何数字。
额度归属：只有 Codex 从会话 rollout 的 rate_limits 取真实额度；DSH 账本无法证明对应当前终端账号，Claude/OpenCode 无可靠数据源，均显示“额度未知”。身份多候选或 uncertain 直接 unknown，不选 latest、不读正文。
额度异步：按 `program:session` 键控缓存 30 秒；切身份 generation++，旧请求晚到不覆盖；切到 shell/Files、关闭、卸载都清理 controller 与 timer；轮询 1 秒只比对身份，不每次 render exec。

### 用户确认的交互原则
按下即可见抓取态：尺寸、边框与阴影的变化立即出现，不设长按门槛。
按住期间连续跟手：指针到哪卡片到哪，只有相邻行让位允许补间。
松手自然落位：目标行确定后收回到常态，不出现跳变。
尺寸以中心稳定：放大时上下左右对称补偿，布局不跳；图标按可见形状居中。
层级紧凑，颜色取现有主题，操作入口直白，不引入第二套视觉语言。
手感是本组件的验收门槛：顺序最终正确、自动测试通过都不能代替过程验收。
上述尺寸是 agent-workbench 的基准；16ms 轮询只是当前实现，不是所有组件的必用规范。

## 收尾状态（r1）
| 项 | 状态 | 证据/说明 | 下一步负责人 |
|---|---|---|---|
| 视觉 r1：单树/项目头/分支/选中/行对齐 | 已实现，静态截图已复核 | 项目头去灰底、active 用前景色、轻 hover；真实分支图标 + dim + 截断 + tooltip；极轻树线 + 每行短横；普通行无底、hover 轻、选中浅底 + 左 2px；图标上移对齐两行。截图 `docs/quality/visual-r1-sidebar.png`、`visual-r1-rows.png` | t2 视觉复核；选中行 1px 外圈是否保留待裁 |
| 视觉 r2：完整 branch + 底栏分组 | 已实现，静态实拍已过；长 branch/窄栏/partial 未验 | 项目头两层：名称/菜单第一行、完整 branch 第二行，slash/hyphen 后断行、无省略号；底栏指标组 + 费用主金额；静态实拍 `docs/quality/visual-r2-fee-live.png`、`docs/quality/visual-r2-quota-live.png`；长 branch/240–268 窄栏/partial 真实态无可靠隔离环境，标未验 | t19 已收；代码冻结，待用户实测 |
| 项目菜单：上移/下移/更多操作 | 已实测通过（用户实机） | 自定义 popup；上移/下移调用官方 `space.move`（1-based，`1=第一`）；更多操作转官方 menu，保留 Worktree 与 `space.close` 的询问确认。无埋点，记为用户实测 | 已收 |
| hover 600ms 提示 | 已实测通过（用户实机） | HoverHint 的 600ms 状态测试通过；用户实机悬停确认出现提示 | 已收 |
| 审批提示不抢焦点 | 待实测；根因在核心/流程，不在现有 mod | 官方 `alert` 只做 settled→unsettle + toast，不 select/focus；本地 mod 的 space/tab/pane/agent 跳转都在 click handler；需双会话 trace 区分 settled、terminal.keep、toast 点击 | t2 审方案；用户/t2 双会话实测 |
| 抓取/跟手/让位/落位 | 已实测通过（用户实机） | `/tmp/herdr-drag-diag.log` 四种路径：moves=0 判 focus、3.7px 判 focus（4px 阈值）、456 次跟手后 reorder 落到第 2 行、Esc cancel 生效；`workbench.order` 写回 0..7 连续无重复；lagMax 10–13ms | 已收 |
| 合并导航/空 shell/折叠选中分离 | 已实现；回归待实测 | 单列表、空或仅 shell Space 仍可进入、折叠与选中分离；项目菜单入口已替换 | t2 实机回归 |
| 最近会话 | 已实现；回归待实测 | 整行恢复、失败仅新建、全局 >8 展开此前已验；合并导航后未重跑 | 用户/t2 回归 |
| 额度栏/费用第二行 | t12 接入中，待完成/验收 | 交接后 t12 已在 main.js 加 usage 控制器、计时器与 `usageLine`（22:50），并部署到本机（22:50:36）；`quotaView` 尚未调用，第二行还未实际渲染；我未再改 main.js | t2 验收；t12 完成接线并实测 |
| 部署/交接 | r1 版已部署；交接后 t12 已改并部署 | 22:39 的 r1 版与 `~/.config/herdr-app/mods/agent-workbench/{main.js,nav.js,model.js}` 逐文件 cmp 一致；交接后 t12 在 main.js 加 usage 并部署（22:50:36），当前仓库与部署 main.js/nav.js/model.js 仍 cmp 一致；`quotaView` 未调用 usageLine，费用第二行未渲染；main.js/nav/model/hint/SVG/install 已交回 t2，我未再改 | t2 统一部署/验收；用户实测 |
| 后台子 agent 行 | 已实现，单测通过并实拍 | 无 pane、父在同 Space 的 live 终端单独成行；图标取父 agent 的 `program.icon/tint`（`terminals()` 的 program 无 icon），第一行程序名 +「· 后台」、第二行任务名，父名只进 tooltip；实拍 `docs/quality/t22-sidebar.png` | 用户实机看真实子 Agent 行 |
| footer 固定 96 | 已实现，单测通过；240/268 实拍过 | `visual.js` `FOOTER_H=96`、`footerHeight()`；费用三合一在 240 会换行，故取容纳两行的固定值，所有分支共用；实拍 `docs/quality/t16-fee-240.png`、`t16-fee-268.png` | 用户实机看高度不跳 |
| 额度状态优先 | 已实现，单测通过 | 费用行只在额度 `unknown` 时出现；`loading/error/stale` 显示额度文案（`main.js` `quotaView`）；`tests/visual.test.mjs`「quota 状态决定底栏主行」 | 用户按 r2 三步实测三态是否还被子行遮住 |
| 长 branch 断点 | 已实现，实拍通过 | slash/hyphen 后插零宽断点、保留原文无省略号（`visual.js` `branchTokens`）；实拍 `docs/quality/verify-t19-r2-long-branch-268.png` | 用户实机长分支名 |
| 双高亮修复 | 已实现，单测通过 | 选中行不再叠 hover 底色，只留浅底 + 左 2px accent；`rowSelected` 区分主行与后台行（`subagents.js`、`main.js` 行渲染）；`tests/subagents.test.mjs` | 用户实机 hover/选中切换 |
| 收尾清理 | boot 诊断已删；drag 诊断保留 | `.tmp/` 与 `mods/*/gpui-kit.d.ts` 已 ignore，`jsconfig.json` 保留入库；DIAG 拖拽日志按 t19 要求留到用户实测连续拖动后；未提交清单见 T-10 交件 | t19 复核清单，用户实测后决定提交 |
| 系统通知点击跳转 | 不可用（macOS 27 + terminal-notifier 3.1.0） | 通知能发（`notify-events.log` 有 notify-ok）；点击后 `focus.sh` 未被调用（`notify-click.log` 不存在）、Herdr 焦点未变；带 `-execute` 的探针点击后也无写入。结论：跨应用只能提醒、不能跳转 | t19/用户定方向 |
| 应用内浮层 | 只读，无「前往」按钮 | 行尾只有 ×；跳转唯一路径=侧栏 agent 行点击。曾有 go-commit（armed=true、hover 1138ms、press 命中 48×26）被误触，浮层覆盖终端无法根除误触，故去掉可点击 | 三选项待定 |
| 后续三选项 | 待用户定 | A 恢复应用内可点 toast（8s）+ 只读浮层常驻（推荐）；B 仅系统通知提醒；C 自建 helper 让系统通知可点（约 1–1.5h） | 用户 |
| 终端折叠持久化 | 已实测通过（用户实机） | `data/agent-workbench/store.json` 写入 `{"sp58bd15…":true}`，`layout.switch` 重挂后仍在，用户视觉确认收起；`tests/model.test.mjs` 覆盖序列化/坏 JSON | 已收 |
| 真机 install.mjs | 已实测通过 | `node scripts/install.mjs` exit 0；布局前后逐项一致（sidebar 268/240/480、toast、floating）；7 个 mod check passed；仓库 vs 部署 cmp 0 差异 | 已收 |
| DSH/Claude 恢复 | 暂缓 | 按用户要求低优先级，不在本轮完成项 | 用户后续决定 |

## 验收结果

### 本轮增量（通知与侧栏）
- 系统通知：macOS 27 + terminal-notifier 3.1.0 只能提醒，点击不跳转；应用内浮层只读，跳转唯一路径是侧栏 agent 行。
- 未验清单：Codex 额度错误态（无真实样本）、系统通知点击跳转（已知限制）。
- 新增 mod 清单：`mods/notify`、`mods/notify-toast`、`mods/workspace-chrome`（均已入库）；三个都已进 `install.mjs` 的 copy 列表；生成布局会写入 `toast: notify-toast` 与右下角 `notify-float`（重复执行不叠加）。

### 首版历史结果（19 项）
首版 19 项测试、4 个 mod 检查通过，当时 Herdr 无运行错误。
Codex 已实际完成关闭、恢复与原上下文问答；失败后新建路径也已实际点击验证。
OpenCode 独立引擎重启载入和 PID 身份事件验证通过；DeepSeek 精确挂载身份验证通过。
两个独立配置窗口的任务名、顺序同步已截图验证；分屏已实测并关闭临时测试 shell。
边界：远程 PID 不探测、多候选不猜测、旧 OpenCode 需工作台启动器，详见 README。
DeepSeek 与 Claude 的模型上下文问答未单独实测，不以此保证任何会话均可恢复。

### 本轮 r1 运行证据（冻结 74 项，交接后复跑 79 项）
- 冻结时 `npm test`：74/74 通过（2026-11-13；含 model/nav/hint 与费用模块并行测试）。
- 交接后复跑：`npm test` 79/79 通过（t12 新增费用测试），`NPM_TEST_EXIT=0`；`herdr-app check mods/agent-workbench` check passed，`CHECK_EXIT=0`；`herdr-app status` layout `agent-workbench`，`errors: []`。
- `git diff --check`：exit 0；我本阶段只改本计划文档（AGENTS/rules/plans README 的改动由 t5/t2 完成，未触碰）。
- 部署：22:39 的 r1 版与 `~/.config/herdr-app/mods/agent-workbench/` 的 main.js/nav.js/model.js `cmp` 一致；交接后 t12 于 22:50 修改并部署 main.js（22:50:36），当前仓库与部署 main.js/nav.js/model.js 仍 `cmp` 一致；`quotaView` 尚未调用 `usageLine`，费用第二行未渲染。
- 静态截图：`docs/quality/visual-r1-sidebar.png`、`visual-r1-rows.png`；r2 布局样图 `docs/quality/visual-r2-mockup.png`（gitignore，不外传）。
- 审批焦点：官方 `src/window.rs` 的 `alert` 只做 settled→unsettle + toast，不 select/focus；本地 mod 没有状态驱动的自动跳转；待双会话 trace 区分 settled、`terminal.keep`、toast 点击。
- 未提交：保留现有未提交改动；不 reset、不 commit、不 push、不 merge、不 publish。
- 待用户实测：项目菜单弹层与“更多操作”、hover 600ms、连续拖动；r2 完整 branch/底栏方案待 t2 审；t12 费用第二行待接线后另验；这些通过前不宣称视觉/手感完成。
