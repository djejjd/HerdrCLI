# HerdrCLI

一套给 [Herdr](https://herdr.dev/) 用的桌面布局和扩展组件。把机器、工作区和 Agent 放进同一棵侧栏文件树，终端标签再多也可以从溢出菜单切换。适合同时在几个项目里跑 Codex、OpenCode 或 OMP 的开发者。

![Herdr 底栏显示当前模型的 5 小时和每周剩余额度，低额度数字以橙色强调](docs/images/magpie-quota.png)

## 能做什么

- **管理工作区和 Agent**。侧栏按机器和工作区分组，支持折叠、拖动排序和右键重命名。
- **快速切换终端**。标签宽度不足时从溢出菜单选择。需要授权或回应的 Agent 会在侧栏行尾提示。
- **查看 Magpie 额度**。底栏随当前终端的主会话切换模型，直接显示可匹配的额度。点击底栏可查看重置时间和其他账号的额度。剩余低于 10% 的窗口单独高亮。

## 快速开始

先安装并打开 Herdr 桌面版，确认终端能运行 `herdr-app`。以下命令适用于 macOS 上的默认 Herdr 配置目录，需有 Git 和 `rsync`。额度功能另需 Node.js 20+ 和本机正在运行的 [Magpie](https://usemagpie.ai/)。

```bash
git clone https://github.com/djejjd/HerdrCLI.git
cd HerdrCLI

rsync -a --backup --suffix=.herdrcli-backup mods/ ~/.config/herdr-app/mods/
rsync -a --backup --suffix=.herdrcli-backup layouts/agents-order.json ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name agents-order
```

第一次使用建议从 `agents-order` 布局开始。可以点 Herdr 标题旁的「+」新建本机工作区。连接多台机器时，新建入口在各机器的行尾。

Magpie 额度读取默认使用本机网关的 3425 端口。当前会话的账号归属有歧义时，可以点击底栏查看各张额度卡。模型或账号的自动识别取决于终端提供的会话数据。

## 更多布局

需要纯终端、工作台或其他布局时，参阅[布局一览](docs/layouts/README.md)。安装前已有自定义布局，或需要恢复备份时，参阅[布局安装与恢复](docs/operations/restore-layout.md)。

## 贡献与许可

欢迎通过 [Issues](https://github.com/djejjd/HerdrCLI/issues) 反馈问题。涉及布局时，请附布局名、Herdr 版本和复现步骤。运行 `npm test` 执行项目测试。

项目按 [LICENSE](LICENSE) 授权。

<!--
状态: active
创建: 2026-11-13
最后更新: 2026-11-21
关联: docs/layouts/README.md, docs/operations/restore-layout.md
-->
