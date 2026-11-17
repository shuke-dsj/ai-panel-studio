import { randomUUID } from 'node:crypto';
import type { Intent, Participant } from '../shared/types.js';
import { phaseLabels } from '../shared/types.js';
import { Store } from './db.js';
import type { Model } from './model.js';
import { ModelError } from './model.js';
import {
  insightSchema,
  intentSchema,
  rosterSchema,
  speechSchema,
  closingSchema,
  reviewSchema,
} from './schemas.js';
import { phaseFor, selectSpeakers, validateInsights, reconcileInsights } from './scheduler.js';
import { expertSpeechSchema } from './utterance.js';
import { buildContext, contextInput, type DiscussionContext } from './context.js';
import { directConsistencyIssues, type ConsistencyIssue } from './consistency.js';
import { renderGroundedSummary } from './summary.js';
const colors = ['#15745b', '#227a64', '#427abf', '#8c58ac', '#b78626', '#ba5e68', '#59818c'];
export class Engine {
  jobs = new Map<string, Promise<void>>();
  rosterJobs = new Set<string>();
  constructor(
    public store: Store,
    public model: Model,
    private contextBudget = 28000,
  ) {}
  private ensureMode(d: import('../shared/types.js').Discussion) {
    if ((d.source === 'test') !== (this.model.mode === 'demo'))
      throw Object.assign(
        new Error(
          '这场讨论的模型模式与当前服务不一致。请切回原模式继续，或新建讨论，避免混淆演示与真实记录。',
        ),
        { statusCode: 409 },
      );
  }
  private log(entry: unknown) {
    if (process.env.NODE_ENV !== 'test') console.info(JSON.stringify({ panel: entry }));
  }
  context(id: string) {
    return buildContext(
      this.store.snapshot(id),
      this.store.checkpoint(id).queue,
      this.contextBudget,
    );
  }
  private input<T extends Record<string, unknown>>(context: DiscussionContext, extra: T) {
    return contextInput(context, extra, this.contextBudget);
  }
  async generate(id: string) {
    const d = this.store.get(id);
    this.ensureMode(d);
    if (this.rosterJobs.has(id))
      throw Object.assign(new Error('阵容正在生成，请稍候。'), { statusCode: 409 });
    if (!['draft', 'roster_ready'].includes(d.status))
      throw Object.assign(new Error('确认后不能更换阵容。'), { statusCode: 409 });
    this.rosterJobs.add(id);
    this.store.update(id, { status: 'generating', error: null });
    try {
      const schema = rosterSchema.refine(
        (v) =>
          v.participants.length === d.expertCount + 1 &&
          v.participants.filter((p) => p.role === 'moderator').length === 1 &&
          v.participants[0].role === 'moderator' &&
          new Set(v.participants.map((p) => p.name)).size === v.participants.length,
        '阵容数量、主持人或姓名不符合要求',
      );
      const output = await this.model.run(
        'roster',
        { topic: d.topic, expertCount: d.expertCount },
        schema,
      );
      const people: Participant[] = output.participants.map((p, i) => ({
        ...p,
        id: randomUUID(),
        discussionId: id,
        color: colors[i],
      }));
      this.store.roster(id, people);
    } catch (error) {
      this.store.update(
        id,
        {
          status: this.store.participants(id).length ? 'roster_ready' : 'draft',
          error: this.errorText(error),
        },
        'error',
      );
      throw error;
    } finally {
      this.rosterJobs.delete(id);
    }
  }
  confirm(id: string) {
    const d = this.store.get(id);
    if (d.status === 'ready') return;
    if (d.status !== 'roster_ready')
      throw Object.assign(new Error('请先生成并确认阵容。'), { statusCode: 409 });
    this.store.update(id, { status: 'ready', error: null });
  }
  start(id: string) {
    const d = this.store.get(id);
    if (['running', 'pausing', 'ending', 'summarizing', 'completed'].includes(d.status)) return;
    if (!['ready', 'paused', 'error'].includes(d.status))
      throw Object.assign(new Error('当前状态不能开始讨论。'), { statusCode: 409 });
    this.ensureMode(d);
    if (this.store.participants(id).length !== d.expertCount + 1)
      throw Object.assign(new Error('嘉宾阵容不完整。'), { statusCode: 409 });
    const next = d.resumeStatus ?? 'running';
    this.store.update(id, { status: next, error: null, resumeStatus: null });
    this.launch(id);
  }
  pause(id: string) {
    const d = this.store.get(id);
    if (d.status === 'running') this.store.update(id, { status: 'pausing' });
    else if (!['pausing', 'paused'].includes(d.status))
      throw Object.assign(new Error('当前状态不能暂停。'), { statusCode: 409 });
  }
  end(id: string) {
    const d = this.store.get(id);
    if (['completed', 'summarizing', 'ending'].includes(d.status)) return;
    if (!['running', 'pausing', 'paused', 'error'].includes(d.status))
      throw Object.assign(new Error('请先开始讨论。'), { statusCode: 409 });
    this.ensureMode(d);
    this.store.update(id, {
      status: this.jobs.has(id) ? 'ending' : 'summarizing',
      resumeStatus: 'summarizing',
      error: null,
    });
    this.launch(id);
  }
  private launch(id: string) {
    if (this.jobs.has(id)) return;
    const promise = this.work(id)
      .catch((error) => {
        const d = this.store.get(id);
        this.log({
          discussionId: id,
          error: error instanceof ModelError ? error.code : 'UNEXPECTED',
        });
        this.store.update(
          id,
          {
            status: 'error',
            error: this.errorText(error),
            resumeStatus: ['ending', 'summarizing'].includes(d.status) ? 'summarizing' : 'running',
          },
          'error',
        );
        this.store.resetActivities(id);
      })
      .finally(() => {
        this.jobs.delete(id);
        if (['running', 'summarizing', 'ending'].includes(this.store.get(id).status))
          this.launch(id);
      });
    this.jobs.set(id, promise);
  }
  private errorText(error: unknown) {
    return error instanceof ModelError
      ? error.message
      : '讨论步骤未完成，请重试。详细错误类别已记录，未暴露模型响应。';
  }
  private async speak(id: string, person: Participant, directive: string, intent?: Intent) {
    this.store.activity(id, person.id, {
      state: 'speaking',
      focus: intent?.publicReason ?? directive,
    });
    const context = this.context(id);
    const aliases = new Map(context.evidenceMemory.anchors.map((a) => [a.id, a.messageId]));
    const ids = new Set([
      ...context.messages.map((m) => m.id),
      ...context.evidenceMemory.anchors.map((a) => a.messageId),
    ]);
    const people = new Set(
      context.participants.filter((p) => p.role === 'expert').map((p) => p.id),
    );
    const schema = (person.role === 'expert' ? expertSpeechSchema : speechSchema)
      .transform((value) => ({
        ...value,
        replyTo: value.replyTo ? (aliases.get(value.replyTo) ?? value.replyTo) : null,
      }))
      .refine(
        (v) =>
          (v.replyTo === null || ids.has(v.replyTo)) &&
          (v.addressedTo === null || people.has(v.addressedTo)),
        '引用或追问对象必须属于当前讨论',
      );
    let corrections: ConsistencyIssue[] = [];
    let result!: import('zod').infer<typeof speechSchema>;
    let approved = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      result = await this.model.run(
        'speech',
        this.input(context, { current: person, directive, intent, corrections }),
        schema,
      );
      corrections = directConsistencyIssues(result.text, context);
      if (!corrections.length) {
        const refs = new Set([
          'topic',
          ...context.messages.map((m) => m.id),
          ...context.evidenceMemory.anchors.map((a) => a.messageId),
        ]);
        const review = await this.model.run(
          'review',
          this.input(context, { candidate: result.text, speakerId: person.id }),
          reviewSchema
            .transform((value) => ({
              issues: value.issues.map((issue) => ({
                ...issue,
                conflictsWith: issue.conflictsWith.map((id) => aliases.get(id) ?? id),
              })),
            }))
            .refine(
              (v) =>
                v.issues.every(
                  (i) =>
                    result.text.includes(i.quote) && i.conflictsWith.every((id) => refs.has(id)),
                ),
              '审查必须引用候选原话和有效来源',
            ),
        );
        corrections = review.issues;
      }
      if (!corrections.length) {
        approved = true;
        break;
      }
      this.log({ discussionId: id, consistencyRejected: corrections.map((i) => i.kind), attempt });
    }
    if (!approved)
      throw new ModelError(
        'CONSISTENCY',
        '发言仍存在范围、时间线或共识归因冲突，已暂停且未提交该发言，请澄清后重试。',
      );
    const cp = this.store.checkpoint(id);
    if (person.role === 'expert') cp.queue = cp.queue.filter((i) => i.participantId !== person.id);
    this.store.message(
      id,
      {
        participantId: person.id,
        text: result.text,
        replyTo: result.replyTo,
        addressedTo: result.addressedTo,
        phase: this.store.get(id).phase,
      },
      cp,
    );
    this.store.activity(id, person.id, { state: 'idle', focus: person.focus });
  }
  private async updateInsights(id: string) {
    const old = this.store.insights(id);
    const result = await this.model.run(
      'insights',
      this.context(id),
      insightSchema.refine((v) => {
        const ids = v.items.flatMap((i) => (i.id ? [i.id] : []));
        return (
          new Set(ids).size === ids.length &&
          v.items.every((i) => !i.id || old.some((p) => p.id === i.id && p.kind === i.kind)) &&
          v.resolvedDisputes.every((r) =>
            old.some((p) => p.id === r.id && p.kind === 'disagreement'),
          )
        );
      }, '沿用已有同类成果ID，关闭分歧必须引用已有分歧ID'),
    );
    const s = this.store.snapshot(id);
    const cp = this.store.checkpoint(id);
    cp.pendingInsight = null;
    cp.roundProgress = !!cp.roundProgress || result.progress;
    if (!cp.queue.length && cp.roundActive) {
      cp.noProgress = cp.roundProgress ? 0 : cp.noProgress + 1;
      cp.roundActive = false;
    }
    this.store.replaceInsights(
      id,
      reconcileInsights(
        old,
        validateInsights(result, s.messages, s.participants, old),
        result.resolvedDisputes ?? [],
        s.messages,
      ),
      result.contextSummary,
      cp,
    );
  }
  private settlePause(id: string) {
    if (this.store.get(id).status === 'pausing') {
      this.store.update(id, { status: 'paused', resumeStatus: 'running' });
      this.store.resetActivities(id);
      return true;
    }
    return this.store.get(id).status === 'paused';
  }
  private async work(id: string) {
    const moderator = this.store.participants(id).find((p) => p.role === 'moderator')!;
    while (true) {
      let d = this.store.get(id);
      let cp = this.store.checkpoint(id);
      if (cp.pendingInsight) {
        await this.updateInsights(id);
        continue;
      }
      if (this.settlePause(id)) return;
      d = this.store.get(id);
      if (
        ['ending', 'summarizing'].includes(d.status) ||
        d.turns >= d.maxTurns ||
        cp.noProgress >= 2
      ) {
        await this.finish(id, moderator);
        return;
      }
      if (d.status !== 'running') return;
      const phase = phaseFor(d.turns, d.maxTurns);
      if (d.phase !== phase) this.store.update(id, { phase });
      const hostAlreadySpoke = this.store
        .messages(id)
        .some((m) => m.participantId === moderator.id && m.phase === phase);
      if (!hostAlreadySpoke) {
        await this.speak(
          id,
          moderator,
          phase === 'exploration'
            ? '开场：界定议题、约束和评审标准，邀请不同观点。'
            : `阶段推进至${phaseLabels[phase]}，针对当前分歧提出一个具体问题。`,
        );
        continue;
      }
      cp = this.store.checkpoint(id);
      if (cp.queue.length) {
        const next = cp.queue[0];
        const person = this.store.participants(id).find((p) => p.id === next.participantId)!;
        await this.speak(id, person, '回应最新上下文，贡献一个有实质进展的观点。', next);
        continue;
      }
      const experts = this.store.participants(id).filter((p) => p.role === 'expert');
      const context = this.context(id);
      const outcomes = await Promise.allSettled(
        experts.map(async (person) => {
          this.store.activity(id, person.id, {
            state: 'preparing',
            focus: `关注${person.focus}，评估是否参与。`,
          });
          const aliases = new Map(context.evidenceMemory.anchors.map((a) => [a.id, a.messageId]));
          const messageIds = new Set([
            ...context.messages.map((m) => m.id),
            ...context.evidenceMemory.anchors.map((a) => a.messageId),
          ]);
          const result = await this.model.run(
            'intent',
            this.input(context, { current: person }),
            intentSchema
              .transform((value) => ({
                ...value,
                replyTo: value.replyTo ? (aliases.get(value.replyTo) ?? value.replyTo) : null,
              }))
              .refine(
                (v) => v.replyTo === null || messageIds.has(v.replyTo),
                '回应对象不属于当前上下文',
              ),
          );
          this.store.activity(id, person.id, {
            state: result.apply ? 'preparing' : 'idle',
            focus: result.publicReason,
          });
          return { ...result, participantId: person.id };
        }),
      );
      const rejected = outcomes.find((o) => o.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      const intents = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []));
      cp = this.store.checkpoint(id);
      d = this.store.get(id);
      cp.queue = selectSpeakers(
        intents,
        this.store.messages(id),
        this.store.insights(id),
        experts,
        Math.min(2, d.maxTurns - d.turns),
      );
      if (!cp.queue.length) cp.noProgress++;
      else {
        cp.roundActive = true;
        cp.roundProgress = false;
      }
      this.store.setCheckpoint(id, cp);
      this.log({
        discussionId: id,
        turns: d.turns,
        selected: cp.queue.map((i) => ({ participantId: i.participantId, kind: i.kind })),
      });
      for (const p of experts)
        if (!cp.queue.some((i) => i.participantId === p.id))
          this.store.activity(id, p.id, { state: 'idle', focus: p.focus });
      if (this.settlePause(id)) return;
      if (!cp.queue.length && cp.noProgress < 2 && this.store.get(id).status === 'running')
        await this.speak(
          id,
          moderator,
          '讨论暂时缺少新观点，请围绕未解决分歧追问一位专家，使用 addressedTo 指定对象。',
        );
    }
  }
  private async finish(id: string, moderator: Participant) {
    this.store.update(id, { status: 'summarizing', phase: 'closing', resumeStatus: 'summarizing' });
    this.store.activity(id, moderator.id, {
      state: 'speaking',
      focus: '整理共识、保留分歧，并提出下一步建议。',
    });
    const context = this.context(id);
    const aliases = new Map(context.evidenceMemory.anchors.map((a) => [a.id, a.messageId]));
    const expertIds = new Set(
      this.store
        .participants(id)
        .filter((p) => p.role === 'expert')
        .map((p) => p.id),
    );
    const messageIds = new Set(
      this.store
        .messages(id)
        .filter((m) => expertIds.has(m.participantId))
        .map((m) => m.id),
    );
    const result = await this.model.run(
      'summary',
      this.input(context, { purpose: 'grounded-summary' }),
      closingSchema
        .transform((value) => ({
          highlightMessageIds: [
            ...new Set(value.highlightMessageIds.map((id) => aliases.get(id) ?? id)),
          ],
        }))
        .refine(
          (v) => v.highlightMessageIds.every((id) => messageIds.has(id)),
          '只能选择本场实际专家发言',
        ),
    );
    this.store.update(
      id,
      {
        status: 'completed',
        summary: renderGroundedSummary(this.store.snapshot(id), result.highlightMessageIds),
        error: null,
        resumeStatus: null,
      },
      'completed',
    );
    this.store.resetActivities(id);
  }
  async wait(id: string) {
    while (this.jobs.has(id)) await this.jobs.get(id);
  }
}
