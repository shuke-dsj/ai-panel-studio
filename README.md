# AI Panel Studio

本地 AI 圆桌讨论 Web App。输入话题、确认虚构专家阵容，观看主持人引导下的自主讨论，实时追踪共识、分歧与最终总结。

React + TypeScript / Fastify / Node 内置 SQLite / SSE。支持多场讨论隔离、发言边界暂停、失败步骤重试、断线恢复与重启恢复。

## 快速开始

需要 **Node.js 24+**、npm。无需单独安装 SQLite 或 Python。

```powershell
npm ci
npm run db:init
npm run dev
```

打开 <http://127.0.0.1:5173>。前端 5173，后端 3001，均只监听本机。

首次启动自动初始化数据库并加入 5 场人工编写示例。它们用于展示讨论结构，**不是已经完成的真实模型验收证据**。数据库保存在 `data/panel.sqlite`，不会提交到 Git。

### 真实模型配置

复制 `.env.example` 为 `.env`，在后端设置：

```dotenv
MODEL_MODE=real
MODEL_API_KEY=你的服务密钥
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=账户实际可用的模型ID
```

适配器请求 `${MODEL_BASE_URL}/chat/completions`，采用 `response_format: {"type":"json_object"}`。若服务要求 `/v1` 路径，将其包含在 BASE_URL 中。请使用账户可用的 API 模型 ID，不直接把产品宣传名称作为 ID。`DEEPSEEK_API_KEY` 可作为 `MODEL_API_KEY` 的后端别名。

修改配置后重启服务：

```powershell
npm run model:probe
npm run dev
```

探测会真实调用模型，并验证 JSON 输出；只记录耗时、用量与错误类别。失败不会自动切换到演示模型。正式运行单场最多 20 次专家发言，每轮每位专家各申请一次，因此会发生多次模型调用；开始前请确认账户余额和限流。

其他配置见 `.env.example`：请求超时默认 60 秒、全局模型并发默认 3、输出上限默认 8000 Token、上下文消息预算默认 28000 字符（非 Token 预算）。单次调用失败自动重试一次；长度截断会明确报错，不保存不完整结果。

### 显式演示模式

没有密钥时，可以浏览人工示例，也可以主动开启确定性演示：

```powershell
$env:MODEL_MODE='demo'
npm run dev
```

界面会显示“演示模式”，讨论标明“确定性演示”。该模式只验证交互与工程链路，不产生真实 AI 证据。恢复真实模式时移除这个进程环境变量，或设置为 `real` 后重启。切换模式后不能继续另一模式的未完成讨论，请切回原模式或新建讨论，以免混淆来源。

### 生产构建（本地）

```powershell
npm run build
npm start
```

打开 <http://127.0.0.1:3001>。Fastify 同时提供 API 和构建后的页面。没有登录和远程访问控制，请保持本地监听，不直接暴露到公网。

## 使用流程

1. 首页发起新讨论，输入话题，选择 2–6 位专家和 6–20 次发言。
2. 预览主持人与专家的姓名、职业、Title、立场和关注领域；可整组重新生成。
3. 确认进入演播厅，点击开始。专家依据共享记录自主申请发言，调度器每轮选择 1–2 人。
4. 暂停在当前发言和成果更新后生效；继续保留待处理队列。提前结束由主持人总结。
5. 点击成果中的消息编号回看原文。离开页面不会终止讨论，回来后恢复快照和后续事件。

## 验证命令

```powershell
npm test
npm run build
npm run test:e2e
npm run model:probe
```

本机 E2E 默认使用已安装的 Microsoft Edge。其他系统可先安装 Playwright Chromium，并设置 `PLAYWRIGHT_CHANNEL=chromium`；CI 自动使用 Chromium。E2E 使用独立的 `data/e2e.sqlite` 与显式演示模型，需要 5173 和 3001 端口空闲。

真实示例生成：

先做一场真实短讨论验收：`npm run test:real`。该命令会调用已配置的真实模型，创建4位专家、最多6次专家发言的讨论，并输出只读数据库核对报告。已有场次中断时使用 `npm run test:real -- --resume 讨论ID`；已完成场次只复核，不重新生成。不要把此命令当成免费的单元测试。

```powershell
npm run model:probe
npm run seed:real
```

该脚本为 5 个指定话题逐场生成真实讨论，会产生费用；生成后必须人工审阅，再作为作业示例提交。未配置密钥时脚本退出失败，不伪造数据。真实验证和其他交付状态见 [验证报告](docs/VALIDATION.md)。

## 工程结构与主要 API

| 目录                          | 用途                                         |
| ----------------------------- | -------------------------------------------- |
| `src/pages`、`src/components` | 页面、演播厅组件与响应式样式                 |
| `src/lib`                     | HTTP、快照和有序事件消费                     |
| `server`                      | SQLite、讨论引擎、调度、模型适配与 Prompt    |
| `shared`                      | 前后端共享类型                               |
| `tests`                       | 逻辑、契约、恢复及 E2E 测试                  |
| `scripts`                     | 数据初始化、真实模型探测与真实示例生成       |
| `docs`                        | 产品规格、架构/API、Prompt、工作流与验证报告 |

主要 API：`GET/POST /api/discussions`、`GET /api/discussions/:id`、`POST /api/discussions/:id/{roster,confirm,start,pause,resume,end}`、`GET /api/discussions/:id/events`。详细状态与响应见 [API 文档](docs/API.md)。

## 已完成与限制

已实现：完整产品路径、真实兼容模型适配、显式测试模型、SQLite 状态与事件、动态发言调度、带证据的成果更新、恢复机制、三栏独立滚动、手机页签和自动化测试。

本机真实模型已配置并完成一场真实短讨论，结构/数据库核对和语义审阅见 [真实验证报告](docs/REAL-SMOKE-REVIEW.md)。首次输出截断后从同一场恢复成功；凭据仅保存在被忽略的本机 .env，交付包不含密钥。Claude Code未安装，本轮由Codex完成，没有声称执行过指定工具工作流。5场内置记录仍为人工编写示例，尚未完成5场真实生成与逐场审阅。按用户选择仅本地交付，未配置远程仓库，未发送邮件。

语义共识识别仍依赖模型判断，后端只能确定引用归属、原文匹配和支持者数量，无法证明模型没有遗漏反对意见。无联网检索，观点均未经外部事实核验。上下文采用字符预算与滚动摘要，可能损失早期细节。SQLite schema v1 仅作初始建库，后续升级应加入版本迁移脚本。

后续可扩展：观众提问、真实模型质量基准、调用费用展示、更完善的长对话摘要与人工成果修订。语音、登录和云部署不属于本次 MVP。
