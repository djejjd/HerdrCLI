状态：本地已接入
创建：2026-11-22
最后更新：2026-11-22
关联：../../mods/agents-order/harness-kids.js、../../mods/agents-order/receive-child.py

# Harness 子 Agent 展示协议 v1

父 harness 在自己的 Herdr 终端上发布直接子任务的完整快照。每次派工、状态变化、结束或恢复时更新。通过 `hc label "$HC_TERMINAL_ID" "workbench.children.v1=$packet"` 发布 JSON。`pid` 填 Herdr 记录的父 harness 前台进程号。退出时清除该标签。示例：

```json
{"version":1,"pid":1234,"children":[{"id":"review-1","name":"代码复核","model":"gpt-6-luna","state":"review"}]}
```

每个父会话最多展示 16 项，快照长度上限 8192 字符。`id` 在父会话内稳定唯一。名称和模型仅传展示元数据，不传正文、路径或凭据。普通终端子项由 Herdr 自身展示，harness 只上报无独立终端的子任务。

|变化|上报状态|显示|
|---|---|---|
|开始或恢复工作|working|三点沿方框滚动|
|需要授权或回复|permission / reply|待授权或待回应图标|
|交件等待审核|review|审核图标|
|受阻|blocked|阻塞图标|
|明确完成本轮|completed|主题强调色对勾|
|空闲或中断|idle|空闲图标|
|缺乏状态证据|unknown|中性点|

## 父方登记已收妥

临时子任务交件后，父 Agent 先确认已收入产物、没有后续待办，也没有用户接管或恢复活动，再从自己的本机 Herdr 终端执行命令：

```sh
receipt_tool="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/agents-order/receive-child.py"
python3 "$receipt_tool" list
python3 "$receipt_tool" review-1 12 --temporary --no-pending
```

`list` 只读输出当前父会话可核对的子项 ID 和完成版本。登记时使用该轮实际返回的 ID 和版本。`--temporary` 与 `--no-pending` 是父 Agent 对任务用途和待办的确认，命令成功表示回执已登记或此前已登记。父方应从自己的终端继续，命令使用该终端的 `HC_TERMINAL_ID`，并拒绝远程或非运行中的终端。

Codex 本机适配器以只读方式核实父子关系，以完成事件的轮次生成 `revision`。交件失败或缺少可靠轮次时无法登记。其他 harness 发布可登记子项时，需要在快照中提供稳定且随逻辑父会话更换的 `identity`，并在 `completed` 子项中提供正整数 `revision`，每次新完成都更换。子项同时可发布 `lifecycle.kind`、`lifecycle.pending`、`lifecycle.takeover` 和 `lifecycle.recovering`。收到交互身份、待办、接管或恢复标记时，命令拒绝登记。ID 和父身份使用至多 80 个 ASCII 字母、数字或 `._:-`，以字母或数字开头。

| 当前事实 | 命令与侧栏表现 |
|---|---|
| 父身份与子任务完成版本一致，父方确认临时且无待办 | 合并写入 `workbench.received.v1`，侧栏收起该轮子项 |
| 回执已有相同父身份、子项和版本 | 成功返回，标签无需重写 |
| 父身份或版本变化、子项恢复、待接管或身份未确认 | 保持子项可见，命令拒绝写入 |
| 终端、快照、回执或写入失败 | 返回非零和固定失败阶段，可在重新核对后重试 |

同父命令通过本地文件锁串行合并其他回执。标签写入前重新核实父身份和子项，侧栏按最新快照复核适用性。旧式无父身份回执不会触发收起。收起只影响侧栏显示，宿主保留原会话。关闭侧栏时取消刷新定时器，在途请求受超时限制。
