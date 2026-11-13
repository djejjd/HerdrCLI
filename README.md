状态: implemented
创建: 2026-11-13
最后更新: 2026-11-13
关联: docs/plans/agent-workbench.md; docs/adr/0002-Agent工作台与会话恢复.md

# HerdrCLI · Agent 工作台

基于 Herdr 原生 mod 的个人工作台：保留 Spaces，按 Space 管理 Agent。

## 使用
`npm test` 运行行为测试；`node scripts/install.mjs` 部署到本机 Herdr 配置目录。
部署以已有 `verified-main` 布局为基础，生成 `agent-workbench` 布局。
`herdr-app do layout.switch --name agent-workbench` 切换到工作台。
任务行悬停显示改名入口；六点手柄拖动同 Space 顺序，Esc 取消。

## 恢复能力与边界
名称与顺序保存在 core 终端标签中，已在两个独立配置窗口实测同步。
Codex、Claude 从进程打开的会话文件名识别身份；多个候选时提示无法确认。
DeepSeek 从进程树与原生 session-mounts 元数据匹配；多个挂载时不猜测。
OpenCode 通过工作台专用启动器加载身份插件，仅记录选择事件和会话 ID。
已在工作台外启动的旧 OpenCode 进程，需要通过工作台重新启动后才能提供身份。
恢复按精确 ID 尝试；失败说明原因并提供新建入口，新对话明确提示未恢复上下文。
最近会话元数据保存在当前配置目录，尚不支持跨设备历史同步。
原子启动锁协调同一配置目录的窗口；强制终止应用可能留下锁，需要确认后清理。
远程机器不进行本地 PID 探测，不能确认身份时提供失败说明。
Codex 回合结束后若仍有后台终端在运行，会持续上报 working（上游 openai/codex#60326；0.169.0 实测仍复现），结束后台终端后恢复。

## 验证
19 项 Node 测试通过，4 个 mod 原生检查通过，Herdr 运行无错误。
真实界面验证：Space 分组、拖动、任务名编辑、标题精简、分屏、恢复失败后新建。
Codex 测试会话关闭后从工作台恢复，准确回复关闭前记住的测试代号。
独立 OpenCode 引擎创建会话、重启并重新载入，身份插件匹配新 PID；无模型请求。
DeepSeek 当前活进程与挂载会话 ID 精确匹配；尚未用模型回复验证其完整恢复。
跨窗口同步截图与测试材料保存在本地 docs/quality/，不提交。

## 接口依据
OpenCode 插件只使用官方 chat.message 的 sessionID 和选择事件，不访问对话正文。
参考：https://github.com/anomalyco/opencode/blob/v1.17.0/packages/plugin/src/index.ts
