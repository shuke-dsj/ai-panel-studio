# AI Panel Studio

本地 AI 圆桌讨论 Web App。输入话题、确认虚构专家阵容，观看主持人引导下的自主讨论，实时追踪共识、分歧与最终总结。

现为Codex式工作区：左侧持久讨论组，中央圆桌与底部输入区，右侧可折叠成果和简短总结。点击嘉宾可同时打开多个独立窗口，查看实时公开关注点与该人的历史发言。支持随时调整焦点或明确替换前提，结束后也能在同一组开启新一轮，旧消息和总结保留。

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

探测会真实调用模型，并验证JSON输出；只记录耗时、用量与错误类别。失败不会自动切换到演示模型。新建讨论默认发言安全上限48次，可选96次；API支持6–120次以兼容短回归。专家并行评估参与意向，每轮选1–2位依次发言，每次还有一致性和成果检查，因此一场会发生多次模型调用；开始前请确认账户余额和限流。

默认4专家至少讨论10次，所有专家已有观点后，主持人需连续两次判定充分覆盖或保留稳定分歧才自然收束；判定至少相隔2次新发言。否则由发言数、25分钟活动时间、360次调用中最早达到的安全边界结束，明确说明未必完全收敛。96次档位为45分钟/720次调用。重试计入调用数，暂停和服务离线时间不继续累计。停滞也会明确结束，不能自动无限循环。

其他配置见`.env.example`：请求超时默认60秒、全局模型并发默认3、输出上限默认8000 Token、上下文预算默认56000字符（非Token预算）。15次真实发言曾因28000字符保护材料超预算而暂停，故提高默认值；12,000/28,000的小预算仍用于压力测试。关键材料本身超限仍明确暂停，不自动丢弃。单次调用失败自动重试一次；长度截断会明确报错，不保存不完整结果。

DeepSeek当前模型默认开启高推理；本地回归出现成果分析反复输出截断后，增加可选`MODEL_THINKING=disabled`显式采用非思考模式，保持8,000输出上限和模型ID。兼容服务不支持此参数时留空，适配器不发送该字段。依据[DeepSeek官方思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)，不是假定所有兼容API都支持。隐藏推理始终不读取、记录或渲染。

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

1. 左侧随时新建讨论组，底部输入话题、选择2–6位专家；圆桌立即预览对应人数，主持人另计。
2. 创建后自动生成虚构阵容，节点与独立窗口展示姓名、职业、Title、立场及角色色；可重新生成，用户确认后才开始。
3. 嘉宾头像发言中高亮、准备时正常色、待机时暗淡；点击多位嘉宾可打开各自窗口。现场记录页仅展示正式发言和用户方向，不展示内部申请或隐藏推理。
4. 底部“调整焦点”保留原硬约束；“更新前提”明确替换范围并归档旧成果。输入不会让浏览器执行模型HTML，也不能改变系统规则。已结束的组会开新一轮并保留历史总结。
5. 暂停在当前发言和成果更新后生效；继续保留待处理队列。结束由主持人输出简短总结，可展开全部条件与来源；按事件序号恢复断线。
6. 共识和分歧边讨论边更新，可展开/收起，点击来源回看原文。左侧切换/新建不会终止其他组；手机通过菜单和成果抽屉访问独立区域。

## 验证命令

```powershell
npm test
npm run build
npm run test:e2e
npm run model:probe
```

本机E2E默认使用已安装的Microsoft Edge。其他系统可先安装Playwright Chromium，并设置`PLAYWRIGHT_CHANNEL=chromium`；CI自动使用Chromium。E2E使用独立的`data/e2e.sqlite`与显式演示模型，默认5273/3101端口，不占用户5173/3001服务；可通过E2E_WEB_PORT、E2E_API_PORT调整。

`npm run test:workspace:real`默认运行4专家、上限16次的真实回归，在首次专家发言后调整焦点并重复请求验证幂等；证据写入`docs/evidence/workspace-real-latest.json`。可通过WORKSPACE_EXPERTS、WORKSPACE_TOPIC、WORKSPACE_REPORT_PATH控制人数/议题/独立证据文件，支持`--resume ID`恢复或只读复核原场。费用和调用均真实发生，不作为默认测试执行。`npm run qa:workspace`（或qa:visual）需先运行5274/3102的独立演示服务（WEB_PORT/PORT、MODEL_MODE=demo、DEMO_DELAY_MS=450、DATABASE_PATH=./data/workspace-qa.sqlite），生成桌面和手机视觉证据；QA_URL可覆盖地址。

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

本机真实模型已配置，完成初次真实验收及后续修复回归。最新结果见 [一致性与压缩回归报告](docs/CONTEXT-REGRESSION.md)，历史证据保留于 [初次真实报告](docs/REAL-SMOKE-REVIEW.md)。凭据仅保存在被忽略的本机 .env，交付包不含密钥。Claude Code未安装，本轮由Codex完成，没有声称执行过指定工具工作流。5场内置记录仍为人工编写示例，尚未完成5场真实生成与逐场审阅。按用户选择仅本地交付，未配置远程仓库，未发送邮件。

语义共识识别与发言一致性审查仍依赖模型判断，可能漏判或误报；后端验证引用、逐字证据和支持者，未决分歧不会因省略而关闭。总结按支持者、未决项及原句装配，避免自由撰写扩大一致性。无联网检索，观点未经外部核验。压缩保护原题、条件证据、当前成果及未决分歧，保护材料本身超预算则暂停；句式提取仍可能遗漏隐含条件，不能宣称任意长文无损。SQLite schema v1 仅作初始建库，evidenceMemory为兼容的可选JSON字段。

长上下文验证：`npm run test:context` 运行纯代码合成压力测试；`npm run test:context:real` 额外进行2次真实模型读取，对比完整/压缩资料在错误滚动摘要干扰下的保真度，会产生调用费用。新版本每次正式发言提交前还有语义审查，因此模型调用次数与等待时间高于初版。

后续可扩展：观众提问、真实模型质量基准、调用费用展示、更完善的长对话摘要与人工成果修订。语音、登录和云部署不属于本次 MVP。
