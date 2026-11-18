# API 与持久化契约

最新内部协议补充：Discussion增加可选evidenceMemory（version=1、带原消息ID/角色/序号/类别的原话anchors），与正式消息同事务保存；旧数据可从消息推导，无需重建SQLite。输入压缩按完整JSON字符预算保护关键条件与未决分歧，超预算返回可恢复错误。正式发言增加内部review步骤；失败候选及审查结果不进入Transcript。summary仍是自然语言字符串，由模型选择真实消息ID、服务端按来源归因装配。Insight ID保持稳定，关闭分歧需要新确认原话，不能凭列表省略删除。对外路由和SSE事件类型保持兼容。

追加字段：`summary`为简短的自然语言总结，`summaryDetails`为完整的证据、条件、分歧及阶段安排；二者均写入discussions.data，completed事件和Snapshot携带同一归档内容。`endReason`区分稳定收束、停滞、发言/时间/调用预算和用户结束；达到预算不能称为已达成一致。

共同判断增加逐来源语义ledger-grounding审核，验证同一原子条件和阶段归因。收束判断前/归档前复核议题账本，由ledger独立提出逐ID关闭凭证，后端按实际专家、逐字引用、各方自身最近有效立场和新反对复核；旧状态仍在事件和账本历史中。旧候选resolvedDisputes不再参与关闭。模型的unresolvedIds只可引用已有ID，完整未关闭列表始终从数据库保留，不依赖模型逐一复述；矛盾的ready/needs_more不计收束票数。所有额外调用及重试均受本轮调用/时间预算约束。

所有路由以 `/api` 为前缀。请求与响应为 JSON，SSE 除外。服务仅监听 127.0.0.1；浏览器写操作拒绝跨站来源。无账户和权限系统。

## 路由

| 方法与路径                            | 请求                             | 响应与语义                                         |
| ------------------------------------- | -------------------------------- | -------------------------------------------------- |
| GET `/health`                         | 无                               | `{ok,mode,configured}`，不返回 key、模型地址或凭证 |
| GET `/discussions`                    | 无                               | 按更新时间倒序的 Discussion 列表                   |
| POST `/discussions`                   | `{topic,expertCount?,maxTurns?}` | 201 Discussion；仅创建，不开始运行                 |
| GET `/discussions/:id`                | 无                               | Snapshot，包含当前完整记录与事件游标               |
| POST `/discussions/:id/roster`        | `{}`                             | 等待生成后返回 Snapshot；失败保留旧阵容            |
| POST `/discussions/:id/confirm`       | `{}`                             | 锁定阵容，进入 ready；重复确认幂等                 |
| POST `/discussions/:id/start`         | `{}`                             | 启动独立后端任务，返回 Snapshot                    |
| POST `/discussions/:id/pause`         | `{}`                             | running → pausing；当前发言/成果更新后 paused      |
| POST `/discussions/:id/resume`        | `{}`                             | 恢复 paused/error 的未完成步骤                     |
| POST `/discussions/:id/end`           | `{}`                             | 当前发言结束后总结；重复请求不重复总结             |
| GET `/discussions/:id/events?after=N` | EventSource；支持 Last-Event-ID  | 重放 N 之后的事件，再持续推送；心跳 15 秒          |

topic去除首尾空白后1–2000字符；expertCount整数2–6，默认4。maxTurns安全上限支持6–120、缺省48；新工作区提供48/96两个档位，短回归显式提交6，不将安全上限当自然收束条件。可选maxModelCalls为20–1200，可选maxActiveMinutes为1–90。未知创建字段拒绝。非法输入400，缺失讨论404，非法状态409，模型服务或配置错误503。错误统一`{error:"可展示的中文说明"}`，不暴露原始上游响应。

`POST /discussions/:id/directions`：`{text,mode:"focus"|"replace",clientRequestId:UUID}`。已接入中央底部输入区。同一请求ID幂等；focus保留硬前提，replace归档旧成果并移动boundaryStartSeq，旧消息仍留库，过期候选按directionVersion拒绝提交。结束后或已触及本轮上限时重开周期，保存summaryHistory；确认前修改前提会标记rosterStale，旧阵容不能确认。

## 核心类型

### 2026-11-18：议题账本与历史复核

`POST /discussions/:id/reconcile`，请求 `{}`，等待真实模型复核后返回Snapshot。仅允许本机非示例记录处于completed/paused/error，运行中或重复并发复核返回409；沿用当前模型、费用及调用预算，不自动改用演示。该操作会把当前边界内原文发送到配置接口，调用者应确认历史内容可出站。前提替换、启动和提前结束在复核锁期间被拒绝。

`Discussion.insightLedger`保存version=1、records与audit。记录含稳定id、中性question、当前text、status（consensus/disagreement/question/resolved/merged）、逐字evidence、requiredParticipantIds、aliases、mergedInto、closedAtSeq、历史状态history。每条证据保存messageId、实际participantId、seq、quote、语义stance、supportsClaim；身份和原文由后端核验。audit记录接受、关闭、合并、重开和拒绝原因。question为待外部确认项，不计入专家实质分歧。

`insights`表是账本当前投影，只发布有证据的共识与仍开放分歧；关闭与合并保留在discussions.data账本中。列表省略不删除已验证共识或开放记录；同义合并保留墓碑，历史反对不能重新打开已关闭项。只有关闭后的新相关反对可重开。语义匹配由模型提出，后端不以相似词自动合并不同阶段条件。

后续独立审核若否定已有共识，将verified设为false，原证据及关闭序号只作历史。当前有效关闭必须verified=true；界面将此类候选放入“证据待复核”，不作为共识或当前关闭。初步insights步骤的旧resolvedDisputes字段已忽略，所有关闭只走ledger的双向证据校验，避免两个协议互相冲突。

已完成记录复核时，原总结存入summaryHistory（revisionReason），原成果及账本存入previousContexts（reason=insight_repair）。新投影、账本、历史归档与按新证据装配的总结在同一SQLite事务保存；消息不改写，原事件保留，不额外产生completed事件。提交后推送insights与status，重连快照包含完整账本。

完整 TypeScript 类型见 `shared/types.ts`。

Snapshot 包含 `discussion`、`participants`、`messages`、`insights`、`activities` 与 `cursor`。Message 的 `replyTo` 指向本场真实消息，`addressedTo` 指向本场角色。`turns`仅统计专家正式发言。消息可附kind、directionVersion；用户调整消息为kind=direction，内部调度意向仍不进入Transcript。

来源标记：live 真实运行；curated 人工编写示例；real-example 真实模型生成、仍待人工审阅的示例；test 显式演示模型。来源从创建时确定，不因重启而改变。

## SSE

```text
id: 42
event: update
data: {"discussionId":"...","seq":42,"type":"message","data":{...},"createdAt":"..."}
```

事件类型：status、activity、message、insights、completed、error、roster。data 分别为 Discussion、公开活动状态、Message、当前完整 Insight 列表、Discussion、Discussion、Participant 列表。活动仅含待机/准备/发言中与可公开关注点，不含原始参与意向或评分。

每场 seq 从 1 单调增长。首次加载先读取 Snapshot，然后订阅 after=cursor；服务重放后续事件。重连时 Last-Event-ID 优先于 query。客户端按 seq 去重，过期 HTTP 快照不得覆盖更新的 SSE 状态。发言与 checkpoint 在同一事务写入，事件提交后才广播。

## 恢复语义

检查点保存本轮剩余发言队列、待更新成果的消息 ID、空参与轮数。正式发言失败时保留队列；成果更新失败时先重试成果；总结失败时重试总结。所有正在执行的意向请求结束后才进入错误状态，防止旧请求在重试后覆盖状态。

重启将 running/pausing/ending/summarizing 恢复为 paused，继续时保留原本的收尾意图。生成阵容过程中重启，恢复旧阵容或 draft。MVP 单进程部署，进程内锁保证同场单任务；不支持多个服务进程共享同一数据库调度。

## 数据库

SQLite schema version 1 在 Store 初始化时创建。discussions 保存领域数据、checkpoint 与公开活动；participants/messages/insights/events 均以 discussion_id 关联。messages 和 events 各自按 discussion_id + seq 唯一。启用外键、WAL 和 busy timeout。备份请正常关闭服务后复制数据库，或使用 SQLite 一致性备份工具；不要只复制运行中的主文件而遗漏 WAL。

## 模型接口参考

实现依据官方 [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) 与 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 文档；Fastify SSE 使用 [Reply.hijack](https://fastify.dev/docs/latest/Reference/Reply/)；SQLite 使用 [Node 24 DatabaseSync](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。具体模型 ID 与账户权限须通过真实探测确认。

## API缓存实现补充（2026-11-18）

默认prefix布局只调整真实模型请求组织，不改公共HTTP路由或数据库实体。共享快照材料在任务system前，当前角色/阶段/候选/审核参数在后。日志保留API实际prompt_cache_hit_tokens/miss_tokens及兼容cached_tokens，并标记缺失或不一致，不将输出答案做本地长期缓存。配置回退、真实用量对照与质量范围见CACHE-OPTIMIZATION.md。
