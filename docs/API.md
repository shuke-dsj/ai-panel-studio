# API 与持久化契约

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

topic 去除首尾空白后 1–2000 字符；expertCount 整数 2–6，默认 4；maxTurns 整数 6–20，默认 12。未知创建字段拒绝。非法输入 400，缺失讨论 404，非法状态 409，模型服务或配置错误 503。错误统一 `{error:"可展示的中文说明"}`，不暴露原始上游响应。

## 核心类型

完整 TypeScript 类型见 `shared/types.ts`。

Snapshot 包含 `discussion`、`participants`、`messages`、`insights`、`activities` 与 `cursor`。Message 的 `replyTo` 指向本场真实消息，`addressedTo` 指向本场专家。`turns` 仅统计专家正式发言。

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
