# 作业交付清单与待办

## 已具备

- 项目源码、锁文件、数据库自动初始化、5 组人工示例和 **5 组逐场审阅的真实模型归档**。可在全新数据库离线导入。逐场证据见[样例验收](SAMPLE-ACCEPTANCE.md)。
- 首页列表显示讨论状态、专家人数、发言数、来源和本地年月日时分秒；`time` 保留 API 原始时间。
- Markdown [PRD](SPEC.md)、[前后端架构](ARCHITECTURE.md)、[SQLite ER 与会话保存](DATA-DESIGN.md)、[证据压缩](CONTEXT-DESIGN.md)、[API](API.md) 及 [README](../README.md)。
- [提交版核心 Prompt](CORE-PROMPTS.md)含 6 段原文节选，覆盖 SDD、DDD、TDD、E2E；[工作流](WORKFLOW-SUBMISSION.md)含 3 个典型问题及工程化理解，按 A4、11.5 pt、18 mm 页边距实测 1 页。
- 单元/契约/恢复/隔离测试、浏览器 E2E 测试与实际验证报告。
- 本地真实 Git 演进记录；运行模式和示例来源均明确标识。

## 提交前仍需完成

1. 实际使用 Codex 开发。按用户要求，提交版描述真实的 Codex 工作流。题面另列的 Claude Code + DeepSeek V4 Pro 开发流程没有实际运行记录；DeepSeek 业务回归属于模型运行证据。
2. 当前按用户选择交付本地 Git 与 ZIP。GitHub/Gitee 地址和可访问性验证仍待完成，本轮未推送远程。
3. 邮件提交、收题时间、72 小时截止点与 ¥10 工具额度须结合实际时间和完整账单核对。本轮未发送邮件。

已有真实运行、异常后恢复、长上下文压力及用量证据见[最新回归](COMPACT-CONTEXT-REGRESSION.md)和[压缩压力验收](CONTEXT-REGRESSION.md)。

## 打包

在最终提交保存后运行 `npm run package:source`，生成 `delivery/ai-panel-studio-source.zip`。Git archive 只包含已提交源文件和文档，不包含 node_modules、.env、SQLite、测试临时数据与构建输出。接收方可用 `npm ci` 与 `npm run db:init` 重建本地环境。

源码 ZIP 只含已跟踪的源码、离线归档与文档。实际 Git 历史可以在本地仓库查看；另附 `delivery/ai-panel-studio-history.bundle`，可用 `git clone ai-panel-studio-history.bundle ai-panel-studio` 离线恢复。
