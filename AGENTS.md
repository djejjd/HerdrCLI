状态: active
创建: 2026-11-13
最后更新: 2026-11-13
关联: docs/rules.md; docs/plans/README.md

# 项目名 · AI 入口
本文件是唯一自动加载的入口。只放：红线、开工协议、索引、写入规则；不写架构与业务细节（属于 docs/）。

## 项目定位
- 是什么：（一句话）
- 技术栈：（语言 / 框架）
- 非目标：（明确不做什么）

## 红线（不可让步）
1. 不直推 main，一切经分支 + PR
2. 声明完成前必须有命令输出
3. 改代码前先给根因与文件级方案，等明确同意
4. 不动用户未提交改动，冲突即停
5. 合并 / 删除 / 打标签 / 发布，逐项单独确认
6. 日志不记敏感正文、凭据、完整 URL、Cookie
7. 异步 / 跨进程流程补摘要 + 失败阶段 + 失败分支测试
8. 状态机改动给状态转换表与终态释放验证
9. 提交标题 `type(scope): 中文摘要`
10. 全局规则在 ~/ai/rules.md；与本文件冲突时以本文件红线为准（只能更严）

## 开工协议
1. 读 `docs/plans/README.md`（当前阶段 / 下一步）
2. 读 `docs/adr/` 最近 3 条标题
3. 只读 1 篇结构文档：`docs/architecture/` 首篇；没有则读 `docs/README.md`
4. 再动手

## 多 Agent 协作入口
- 开工前读全局真源 `~/ai/rules.md` §6「协作闭环」（A-01~A-07）；开发 Agent 与监督 Agent 均须遵守，本项目不重复细则。

## 索引
- 规则 → `docs/rules.md`；进度 → `docs/plans/README.md`
- 为什么这么定 → `docs/adr/`；结构 → `docs/architecture/`
- 对外变化 → `docs/releases/`

## 写入规则
| 情况 | 写哪 |
|---|---|
| 下一步 / 阶段 | `docs/plans/README.md` 状态表（只改 1 行） |
| 为什么这么定 | `docs/adr/` 新编号 |
| 项目必须遵守的规则 | `docs/rules.md` |
| 事故复盘 | `docs/quality/`（gitignore，不外传） |

## HD-TODO-01 本 worktree 派工卡
- 身份：DS待办执行(t31)，监督者(t2n)；用户批准方向见 PD-HERDR-002。
- 唯一任务卡：`.tmp/collab/HD-TODO-01/assignment.md`，开工先读；方案与流程记录同目录。
- 方案已通过：以 `.tmp/collab/HD-TODO-01/review-02-approved.md` 为本阶段可写范围及验收约束；先读该卡再实施，其他禁止项继续有效。
- 禁止额外派工、越范围、覆盖用户改动、自动切焦点、永久部署、合并、推送和发布。
- 每阶段交 `CARD`（证据命令与退出码/文件/截图、剩余裁决、下一步），用 `hc send t2n`；交卡后结束回合，不轮询。
