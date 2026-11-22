状态：本地已接入
创建：2026-11-22
最后更新：2026-11-22
关联：../../mods/agents-order/harness-kids.js

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

任务结束后可保留最近记录或从下一份快照移除。关闭侧栏时取消刷新定时器，在途请求有超时；父进程变化时丢弃旧进程快照。Codex 的本机适配器只读查询父子关系，读取不到时显示空列表；父进程不唯一时不展示。
