# 作业交付清单与待办

## 已具备

- 项目源码、锁文件、数据库自动初始化、5 组人工示例和 **5 组逐场审阅的真实模型归档**。可在全新数据库离线导入。逐场证据见[样例验收](五组真实示例与审阅记录.md)。
- 首页列表显示讨论状态、专家人数、发言数、来源和本地年月日时分秒；`time` 保留 API 原始时间。
- Markdown [PRD](产品与工程规格.md)、[前后端架构](前后端架构与开发.md)、[SQLite ER 与会话保存](数据模型设计.md)、[证据压缩](专家上下文、证据压缩与请求缓存设计.md)、[API](API.md) 及 [README](../README.md)。
- [核心 Prompt 记录](PROMPTS.md)包含分阶段原文节选，覆盖 SDD、DDD、TDD、E2E；[工作流](WORKFLOW-SUBMISSION.md)含 3 个典型问题及工程化理解，按 A4、11.5 pt、18 mm 页边距实测 1 页。
- 单元/契约/恢复/隔离测试、浏览器 E2E 测试与实际验证报告。
- 本地真实 Git 演进记录；运行模式和示例来源均明确标识。

## 发布信息

- 开发工具为 Codex。DeepSeek 用于产品运行和真实模型回归。
- [GitHub 源码仓库](https://github.com/shuke-dsj/ai-panel-studio)为私有仓库。提交给评审时需向对应 GitHub 账号授予访问权限。
- 邮件提交、收题时间、72 小时截止点与 ¥10 工具额度须结合实际时间和完整账单核对。

已有真实运行、异常后恢复、长上下文压力及用量证据见[最新回归](紧凑上下文与最新立场设计.md)和[压缩压力验收](内容回归测试.md)。

## 打包

在最终提交保存后运行 `npm run package:source`，生成 `delivery/ai-panel-studio-source.zip`。Git archive 只包含已提交源文件和文档，不包含 node_modules、.env、SQLite、测试临时数据与构建输出。接收方可用 `npm ci` 与 `npm run db:init` 重建本地环境。

源码 ZIP 只含已跟踪的源码、离线归档与文档。实际 Git 历史可以在本地仓库查看；另附 `delivery/ai-panel-studio-history.bundle`，可用 `git clone ai-panel-studio-history.bundle ai-panel-studio` 离线恢复。
