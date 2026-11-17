# 作业交付清单与待办

## 已具备

- 项目源码、锁文件、数据库自动初始化与 5 组人工编写示例。
- Markdown 产品规格、Mermaid 状态机/架构、API 文档和 README。
- 分阶段核心 Prompt 记录（6 段）与开发工作流说明。
- 单元/契约/恢复/隔离测试、浏览器 E2E 测试与实际验证报告。
- 本地真实 Git 演进记录；运行模式和示例来源均明确标识。

## 提交前仍需完成

1. 确认招聘方接受本轮实际开发工具与指定 Claude Code + DeepSeek V4 Pro 的差异；若不接受，需要按指定工具补充真实开发过程，不能补写虚构记录。
2. 本机真实模型已配置，model:probe及一场真实短讨论已验证；保留初始失败、恢复和语义审阅证据，初次质量风险已修复并完成新真实回归与长上下文压力测试，最新结果见CONTEXT-REGRESSION.md。
3. 执行 `npm run seed:real` 生成至少 5 组真实讨论；逐场审阅观点质量、引用、反驳、收敛和总结，记录审阅意见。
4. 将仓库推送到本人控制的 GitHub/Gitee，确认可访问，并补充项目链接。当前未配置 remote，未创建远程仓库。
5. 核对姓名、实际收题时间和 72 小时截止点，将源码与文档打包。题面邮箱与主题格式按原图人工复核；本轮未发送邮件。

## 打包

在最终提交保存后运行 `npm run package:source`，生成 `delivery/ai-panel-studio-source.zip`。Git archive 只包含已提交源文件和文档，不包含 node_modules、.env、SQLite、测试临时数据与构建输出。接收方可用 `npm ci` 与 `npm run db:init` 重建本地环境。

仓库的 Git 历史需通过 GitHub/Gitee 查看；源码 zip 本身不包含 .git。不得把运行中数据库或密钥直接加入交付包。
