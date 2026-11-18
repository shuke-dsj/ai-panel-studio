import { ZodError, type ZodType } from 'zod';
import type { Task } from './prompts.js';
import { buildModelMessages, type RequestLayout } from './request-layout.js';
import { usageMetadata } from './usage.js';
export interface ModelOptions {
  onAttempt?: (attempt: number) => void;
  onUsage?: (report: ReturnType<typeof usageMetadata>) => void;
}
export interface Model {
  run<T>(task: Task, input: unknown, schema: ZodType<T>, options?: ModelOptions): Promise<T>;
  mode: 'real' | 'demo';
  configured: boolean;
}
export class ModelError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}
export class RealModel implements Model {
  mode = 'real' as const;
  configured: boolean;
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private config: {
      key: string;
      baseUrl: string;
      model: string;
      timeout?: number;
      maxTokens?: number;
      concurrency?: number;
      thinking?: 'enabled' | 'disabled';
      requestLayout?: RequestLayout;
      fetcher?: typeof fetch;
      logger?: (entry: unknown) => void;
    },
  ) {
    this.configured = !!(config.key && config.baseUrl && config.model);
  }
  private async acquire() {
    const limit = this.config.concurrency ?? 3;
    if (this.active >= limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
  }
  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
  async run<T>(task: Task, input: unknown, schema: ZodType<T>, options?: ModelOptions): Promise<T> {
    if (!this.configured)
      throw new ModelError(
        'NOT_CONFIGURED',
        '真实模型尚未配置。请在后端 .env 设置 MODEL_API_KEY、MODEL_BASE_URL 和 MODEL_NAME，再重启服务。',
      );
    await this.acquire();
    try {
      let retryHint = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        options?.onAttempt?.(attempt);
        const started = Date.now();
        let report = usageMetadata(undefined);
        const data = input as { discussionId?: unknown } | null;
        let metadata: Record<string, unknown> = {
          requestLayout: this.config.requestLayout ?? 'prefix',
          ...(data && typeof data.discussionId === 'string'
            ? { discussionId: data.discussionId }
            : {}),
        };
        try {
          const response = await (this.config.fetcher ?? fetch)(
            `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.key}`,
              },
              signal: AbortSignal.timeout(this.config.timeout ?? 60000),
              body: JSON.stringify({
                model: this.config.model,
                ...(this.config.thinking ? { thinking: { type: this.config.thinking } } : {}),
                messages: buildModelMessages(task, input, retryHint, this.config.requestLayout),
                response_format: { type: 'json_object' },
                max_tokens: this.config.maxTokens ?? 8000,
                stream: false,
              }),
            },
          );
          if (!response.ok)
            throw new ModelError(
              `HTTP_${response.status}`,
              `模型服务返回 HTTP ${response.status}。请检查账户、模型权限或服务状态。`,
            );
          const body = (await response.json()) as {
            choices?: { finish_reason?: string; message?: { content?: string } }[];
            usage?: unknown;
          };
          const reason = body.choices?.[0]?.finish_reason;
          report = usageMetadata(body.usage);
          metadata = {
            ...metadata,
            finishReason:
              reason && ['stop', 'length', 'tool_calls', 'content_filter'].includes(reason)
                ? reason
                : 'unknown',
            ...report,
          };
          const content = body.choices?.[0]?.message?.content;
          if (reason === 'length')
            throw new ModelError(
              'OUTPUT_LIMIT',
              '模型输出达到长度上限，未完成有效响应。请缩短输出或调整后端输出预算后重试。',
            );
          if (typeof content !== 'string' || !content.trim())
            throw new ModelError('EMPTY', '模型没有返回有效正文。');
          const output = schema.parse(JSON.parse(content));
          this.config.logger?.({
            task,
            attempt,
            durationMs: Date.now() - started,
            ...metadata,
          });
          return output;
        } catch (error) {
          const custom =
            error instanceof ZodError
              ? error.issues.find((i) => i.code === 'custom')?.message
              : undefined;
          const contractRule = custom?.includes('1–2')
            ? 'SENTENCE_LIMIT'
            : custom?.includes('引用或追问')
              ? 'REFERENCE'
              : custom?.includes('收束必须')
                ? 'CONVERGENCE_PROTOCOL'
                : custom?.includes('成果ID')
                  ? 'INSIGHT_ID_PROTOCOL'
                  : undefined;
          const code =
            error instanceof ModelError
              ? error.code
              : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
                ? 'TIMEOUT'
                : (contractRule ?? 'INVALID_OUTPUT');
          const validationIssues =
            error instanceof ZodError
              ? error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
              : undefined;
          this.config.logger?.({
            task,
            attempt,
            durationMs: Date.now() - started,
            error: code,
            ...metadata,
            validationIssues,
          });
          retryHint =
            '\n上次响应未通过输出契约，请重新生成完整有效的 JSON；严格遵守字段、引用 ID 与发言句数要求，保持内容简洁，不增加解释或围栏。';
          if (error instanceof ZodError)
            retryHint +=
              '\n具体校验约束：' +
              JSON.stringify(
                error.issues.slice(0, 6).map((issue) => ({
                  path: issue.path.join('.'),
                  code: issue.code,
                  ...('maximum' in issue ? { maximum: issue.maximum } : {}),
                  ...('minimum' in issue ? { minimum: issue.minimum } : {}),
                })),
              );
          if (code === 'SENTENCE_LIMIT')
            retryHint +=
              ' 上次专家发言超过句数限制，请严格只写1–2句，不使用编号或列表；同句多个条件可用分号连接。';
          if (code === 'REFERENCE')
            retryHint +=
              ' replyTo必须是本场messages[].id或evidenceMemory.anchors[].messageId，不能使用角色ID、片段ID或序号；addressedTo必须为participants[].id，不能是姓名、消息ID或序号。不确定对象时两个字段均用JSON null。';
          if (code === 'CONVERGENCE_PROTOCOL')
            retryHint +=
              ' unresolvedIds只能引用当前insights中的disagreement.id，不使用序号或新造ID。后端会完整保留未关闭记录，不依赖你复述它们来存档；不能证明充分覆盖则ready=false、reason=needs_more。';
          if (attempt === 1)
            throw error instanceof ModelError
              ? error
              : new ModelError(
                  code,
                  code === 'TIMEOUT'
                    ? '模型请求超时，已重试一次。请稍后重试。'
                    : code === 'SENTENCE_LIMIT'
                      ? '模型未遵守专家1–2句发言约束，已重试一次，请重试。'
                      : code === 'REFERENCE'
                        ? '模型引用未匹配本场消息，已重试一次，请重试。'
                        : '模型返回格式无效，已重试一次。请重试或更换支持 JSON 输出的模型。',
                );
        } finally {
          options?.onUsage?.(report);
        }
      }
      throw new ModelError('UNKNOWN', '模型调用未完成。');
    } finally {
      this.release();
    }
  }
}
