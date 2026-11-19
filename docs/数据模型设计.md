# SQLite 数据模型与会话保存

初始化入口为 `npm run db:init`。物理表定义和事务位于 `server/db.ts`，领域类型位于 `shared/types.ts`。SQLite 启用外键、WAL 和忙等待超时。

```mermaid
erDiagram
  DISCUSSIONS ||--o{ PARTICIPANTS : has
  DISCUSSIONS ||--o{ MESSAGES : records
  DISCUSSIONS ||--o{ INSIGHTS : projects
  DISCUSSIONS ||--o{ EVENTS : emits
  DISCUSSIONS {
    string id PK
    text data "Discussion JSON"
    text checkpoint "调度恢复 JSON"
    text activities "公开嘉宾状态 JSON"
  }
  PARTICIPANTS {
    string id PK
    string discussion_id FK
    text data "姓名 角色 颜色 立场"
  }
  MESSAGES {
    string id PK
    string discussion_id FK
    int seq "场内唯一"
    text data "正文 发言人 回复 时间"
  }
  INSIGHTS {
    string discussion_id PK, FK
    string id PK
    text data "当前证据投影"
  }
  EVENTS {
    string discussion_id PK, FK
    int seq PK
    text data "新增消息 成果 用量 状态等"
  }
```

## 领域字段和存储边界

| 字段位置                         | 内容与约束                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `discussions.data`               | 原始话题、有效话题、焦点、方向版本、周期、停止原因、Token 用量和时间。主记录带当前总结、完整依据、历史总结及旧前提归档。   |
| `discussions.data.insightLedger` | 按稳定 ID 保存共识、分歧、待确认、关闭、合并及历史。引用保存消息 ID、专家 ID、序号和原话。归档前保留失效或撤回记录的历史。 |
| `messages.data`                  | 区分正式发言和用户方向调整。发言者、回复关系由业务层验证属于同一场，原文、序号和时间长期保存。                             |
| `insights`                       | 当前可发布的共识和开放分歧，关闭与待确认通过账本读取。                                                                     |
| `checkpoint`                     | 待消费的发言队列、待处理成果消息、无进展轮数、收束状态等。内部意向不会作为现场发言展示。                                   |

## 一次提交与会话恢复

```mermaid
sequenceDiagram
  participant E as 引擎
  participant D as SQLite
  participant W as 浏览器
  E->>D: 事务写入发言、证据记忆、检查点、消息事件
  D-->>E: 提交
  E-->>W: SSE 广播序号
  E->>D: 事务写入成果投影、账本、成果事件
  E-->>W: SSE 推送成果
  W->>D: 通过 API 读取快照与游标
  D-->>W: 重放游标之后的已存事件
```

暂停会保留未完成工作。成果分析失败后续跑时优先处理已提交发言的成果，避免生成重复发言。服务重启后把执行中的讨论恢复为暂停。已完成场次回看时直接读取快照；替换前提后开始新的证据边界，旧正文仍可查。历史复核在事务内保存旧总结和旧账本，再发布新结论。

离线示例以完成状态直接导入角色、正文、当前成果和历史凭证，保留原 ID 与时间。已有同 ID 行优先，种子不覆盖；运行私有数据库、日志和密钥不入包。模型用量只对上游实际返回的指标累计，不反推缺失数据。
