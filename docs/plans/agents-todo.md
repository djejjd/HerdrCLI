状态: 已安装（代码与隔离视觉复核通过；待一次实际点击与滚动确认）
创建: 2026-11-17
最后更新: 2026-11-17
关联: ../adr/0004-待办数据源与导航身份.md; ../../.tmp/collab/HD-TODO-01/plan.md; ../../.tmp/collab/HD-TODO-01/review-02-approved.md

# Agents／待办共用左侧列表

## 背景与目标

在现有 `agents-order` 面板标题行加入 Agents／待办切换，两种模式共用同一列表区域与滚动容器；不新增侧栏高度、并列列表或主区待办页。待办行显示动作图标、短事项名与来源 Agent；点击只在主区打开精确来源对话，左侧保持待办模式、选中与滚动。既有 Agents 排序、置顶、优先级分组、同 Space 拖动、子 Agent 归属与原生跳转不变。

## 数据源与写入责任

- 唯一持久源：`~/ai/collab/pending.md`。审批表保持原语义，仅追加 `事项ID/来源Space/来源Tab/来源终端/来源会话/来源Agent/版本`。
- 同文件新增 `## Agent 待办（待审 / 阻塞）` 表，记录 `待审/阻塞/执行`；仍是监督方单写，执行者与 mod 只读。
- 旧审批消费方只解析第一张含「要你做什么」的表；新增表放其后，实测旧解析器只得到审批行。
- 历史已处理行缺新字段时跳过，不生成错误待办；未处理的旧行保留为 legacy 只读项。
- 不新增第二文件/第二审批源；不用瞬时标签作为事项源。

## 事项契约

- `事项ID`：全局唯一 `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`；新交件换新 ID。
- `版本`：递增正整数；迁移旧行统一为 1。`TODO-EVENT` 带 `expectedVersion`，`OPEN` 用 0；不匹配/旧事件拒绝，应用后版本 +1。
- `eventId` 幂等；`DECISION` 只结束审批决定行，`REVIEW-PASSED` 只结束待审行，`UNBLOCKED` 只结束阻塞行，`OPERATION-DONE` 只结束 `类型=执行` 行，`REWORK` 只结束待审返修行。
- 同 ID 同版本同内容幂等；同版本不同状态/来源/类型/标题为冲突组，计数一次、禁用清除/跳转，全部已处理才消失。
- 授权决定与执行/合并完成点分开：用户确认只清授权行；执行行需真实成功结果（merge commit/成功输出）才清，失败保留。

## 状态与图标

| 显示 | 来源 | 图标 |
|---|---|---|
| 待用户 | 未处理审批行 | `user.svg`（对话气泡，主题提醒色） |
| 阻塞 | 未处理 `阻塞` 行或原生 blocked | `blocked.svg`（停止形，仅图标用错误色） |
| 待审 | 未处理 `待审` 行 | `review.svg`（文件+勾，主题 accent） |
| 执行中 | 原生 working / `执行` 行 | 现有 spinner（中性灰） |
| 空闲 | 原生 idle/done | `idle.svg`（中性灰） |

统一 14px 细线圆角；Agents 行与待办行复用同一套图标。标题/辅助文字保持正常前景或 muted，不让整行红字；错误色只落在小图标上。**产品图标、名称、父子缩进/细树线/归属不变；状态只用独立槽位，不新增卡片/粗边框，不改行高或拖动语义。** 图标只改显示，不改 `RANK`/`urgency`/排序/分组/置顶/拖动/子 Agent 归属。

## 点击与来源身份

1. 用精确 `来源终端` 与 `来源会话` 核验同一来源，实际 pane 必须仍属于 `来源Space`；`来源Tab` 保留发起位置，`terminal.keep` 合法创建新 tab 后跟随同一已核验会话的实际位置。
2. 核验来源会话：omp 读 `~/.omp/run/session-owners/<uuid>.lock`；dsh-tui 读 `~/.dsh-tui/session-mounts.json` owner 后代；codex/claude/opencode 用 `probe.mjs`；其他程序无法核验则不跳。
3. 有 pane：`space.select` → 实际 pane 所在 tab 的 `tab.select` → `pane.focus`；原来源 tab 变化不阻止再次打开同一已核验会话。
4. 无 pane：一律用 `terminal.keep` 新 tab，再有界轮询 `panes()` 后聚焦；不替换/关闭现有 pane。`terminal.show` 会替换视图，已否决。
5. 失败保留事项与选中，第二行显示原因；不按名字、`去哪点`、latest 猜测。

## 实现文件

- `mods/agents-order/main.js`：模式切换、轮询、点击核验/导航、图标。
- `mods/agents-order/todo.js`：双表解析、冲突/版本事件、导航计划、TodoStore。
- `mods/agents-order/todo-view.js`：标题分段、待办行、空/错误/冲突态。
- `mods/agents-order/session.mjs`：会话身份核验（只读文件名/元数据）。
- `mods/agents-order/{user,blocked,idle,review,refresh}.svg`：与现有 1.5px 细线风格一致。
- `scripts/dev/todo-ledger.mjs`：只读 `source`/`validate`，供监督方迁移与校验。

## 异步与资源

- 账本 2 秒轮询 single-flight；generation 丢弃旧结果；close 后不 notify、不写。
- 点击核验只对单次点击、最多一个在途；旧点击结果丢弃。
- `close` 取消定时器、释放 `ScrollHandle`、关闭 TodoStore；`checking()` 时不启动进程副作用。

## 验收口径

- 测试覆盖见 `tests/todo.test.mjs`、`tests/todo-scenario.test.mjs` 与 `npm test`。
- `herdr-app check mods/agents-order` 通过；隔离 home 截图见 `.tmp/collab/HD-TODO-01/evidence-*.png`。
- 真实 `pending.md` 迁移由监督方单写；DS 只运行只读校验（`validate` 退出码 0）。
- 真实配置默认不永久部署；部署前备份 `mods/agents-order`，失败回滚。
- 已知限制：非 omp/dsh/codex/claude/opencode 的 Agent 可能无法核验会话；无 pane 的 `terminal.keep` 路径的焦点时延需监督方/用户一次实机复核。

## 独立复核（2026-11-17，监督者 t2n）

- `node --test tests/todo.test.mjs tests/todo-scenario.test.mjs tests/agents-order.test.mjs`：37/37，退出码 0；`herdr-app check mods/agents-order`：退出码 0。
- 真实账本记录 `HD-TODO-01-REVIEW-R2`：来源会话验证通过；错误 ID/版本拒绝；`REVIEW-PASSED` 仅结束目标记录并递增版本，重复事件幂等。持久更新后的 `todo-ledger.mjs validate`：退出码 0。
- 已复核隔离原生截图中的产品身份、父子层级、状态图标及配色；命令导航与 handler 回归已通过。当前用户窗口的实际点击、连续滚动尚未执行，不能据此宣称交互验收完成。
- 用户单项批准安装后，监督者更新真实 `~/.config/herdr-app/mods/agents-order`；原版备份为 `.tmp/collab/HD-TODO-01/deploy-backup.iwQVkh/agents-order`。安装版原生 check 退出码 0，运行 `errors: []`，当前对话与焦点保持。真实窗口截图 `installed-current-window.png`（本地不提交）。

## 任务命名与改名（命名漏项修复）

- 名称读取优先级：`workbench.name`（trim 非空）→ 人工 tab 名 → 现有动态/产品回退；父行、子行、置顶/优先级视图共用 `names.js` 的 `displayName`。已有长名不截断、不改写，界面用省略号 + 完整 tooltip。
- 产品图标/名称/运行器独立于任务名，不因改名变化；父子缩进/细树线/行高/排序不动。
- hover 铅笔入口在父行、子行、置顶行可达；紧凑 overlay 复用 `Input`，取消不改值；空输入第一次只进入“确认清空”，再次确认才写 `workbench.name=` 并回退。
- `commitName`：label 成功才更新；label 失败保留旧名并显示错误，不关闭编辑。单 Agent tab 同步用有界等待宿主回显（`waitForTabName`，8×80ms），区分“命令已接收、快照稍后更新”和真正超时；失败单独提示“任务名已保存，标签页名称未同步”，不回滚/不假装 label 失败；多 Agent 共用 tab 不同步。
- rename overlay 的 600ms 聚焦定时器保存句柄，`close` 取消；回调再经 `focusIfOpen` 保护，提前关闭后不抢焦点。
- 回归：`tests/agents-order-names.test.mjs` 覆盖长名、动态 title、父子独立、空/清空、16 字、重名、单/多 Agent tab、label 失败、部分同步失败。截图 `evidence-names.png` 为隔离实例中父 t2n“界面统筹与验收”+子 t31“待办交互实现”完整列表；PID 已核验退出。

## 交付前只读 preflight（HD-WORKFLOW-01）

- 命令：`node scripts/dev/collab-preflight.mjs --request <原需求.json> --delivery <交付.json>`；exit 0 技术通过、1 拒绝、2 输入错误。
- 原需求与交付必须分文件；需求 ID 覆盖、减范围用户决定、派发接手人/下一步、模型首响应、资源退出、UI 证据边界逐项检查。
- 错误只含 rule/id/stage；不输出原文/URL/凭据；不 kill 进程、不启 GUI/agent。技术交付可过但明确 `unverified:["interaction"]`，不得冒充 real-click。

## 自动任务名（HD-NAME-AUTO-01）

- 数据源：只读 `workbench.name`、`tab.named`、`AgentInfo.title`/`Terminal.title`；Herdr/hc 无 task/message API，不用 session ID/产品名拼接语义。
- 优先级：人工 `workbench.name`（无 `source` 或 `source=manual`）最高；无名称或 `source=auto` 才从清洗后的标题生成。清洗去掉状态字形/emoji 与 `AGENT:`/`OMP:`/`DS Harness` 等产品前缀，拒绝产品名、cwd、地址、纯 ID、URL。
- 不可靠/空标题保持未命名，显示产品/地址回退；不调用模型、不读对话正文、不截断已有长名。
- 自动名持久写 `workbench.name` 并写 `workbench.name.source=auto`；人工保存写 `source=manual`，永不自动覆盖。存量只补当前 live Agent；标题变化可更新自己写的 auto 名。
- 触发沿用界面首次扫描/刷新，不加后台 daemon；label 失败保留旧名/未命名，按 address 最多重试 2 次。文件：`names.js`（autoNameFromTitle/shouldAutoName/autoNameCandidate）、`main.js` scanAutoNames。
