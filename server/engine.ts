import { randomUUID } from 'node:crypto';
import type { Intent, Participant, DirectionMode, EndReason } from '../shared/types.js';
import type { ZodType } from 'zod';
import type { Task } from './prompts.js';
import {
  BoundaryStop,
  DirectionChanged,
  activeElapsed,
  clockStopped,
  cycleTurns,
  limitsFor,
} from './boundaries.js';
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
  convergenceSchema,
  ledgerSchema,
} from './schemas.js';
import { phaseFor, selectSpeakers } from './scheduler.js';
import { expertSpeechSchema } from './utterance.js';
import { buildContext, contextInput, type DiscussionContext } from './context.js';
import { directConsistencyIssues, type ConsistencyIssue } from './consistency.js';
import { renderGroundedSummary, renderConciseSummary } from './summary.js';
import { applyLedger, ledgerFor, ledgerDigest } from './insight-ledger.js';
const colors = ['#b78626', '#227a64', '#427abf', '#8c58ac', '#ba5e68', '#59818c', '#806347'];
export class Engine {
  jobs = new Map<string, Promise<void>>();
  rosterJobs = new Set<string>();
  repairJobs = new Set<string>();
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
  private async call<T>(task: Task, input: unknown, schema: ZodType<T>): Promise<T> {
    const data = input as { discussionId: string; directionVersion?: number };
    const version = data.directionVersion ?? 0;
    this.store.meterAttempt(data.discussionId, version, true);
    return this.model.run(task, input, schema, {
      onAttempt: (attempt) => {
        this.store.meterAttempt(data.discussionId, version, attempt > 0);
      },
    });
  }
  private assertDirection(id: string, version: number) {
    if ((this.store.get(id).directionVersion ?? 0) !== version) throw new DirectionChanged();
  }
  steer(id: string, text: string, mode: DirectionMode, clientRequestId: string) {
    if (this.repairJobs.has(id))
      throw Object.assign(new Error('成果正在复核，请稍后调整方向。'), { statusCode: 409 });
    const before = this.store.get(id);
    if (before.source === 'curated')
      throw Object.assign(new Error('人工示例仅供浏览，请以此话题新建讨论组。'), {
        statusCode: 409,
      });
    this.ensureMode(before);
    this.store.steer(id, text, mode, clientRequestId);
    if ((this.store.get(id).cycle ?? 1) !== (before.cycle ?? 1)) this.start(id);
    return this.store.snapshot(id);
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
      const output = await this.call(
        'roster',
        {
          discussionId: id,
          directionVersion: d.directionVersion ?? 0,
          topic: d.effectiveTopic ?? d.topic,
          activeFocus: d.focus ?? '',
          expertCount: d.expertCount,
        },
        schema,
      );
      this.assertDirection(id, d.directionVersion ?? 0);
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
          error:
            error instanceof DirectionChanged
              ? '方向已更新，请按新方向重新生成阵容。'
              : this.errorText(error),
        },
        'error',
      );
      if (!(error instanceof DirectionChanged)) throw error;
    } finally {
      this.rosterJobs.delete(id);
    }
  }
  confirm(id: string) {
    const d = this.store.get(id);
    if (d.rosterStale)
      throw Object.assign(new Error('讨论前提已更新，请重新生成并确认阵容。'), { statusCode: 409 });
    if (d.status === 'ready') return;
    if (d.status !== 'roster_ready')
      throw Object.assign(new Error('请先生成并确认阵容。'), { statusCode: 409 });
    this.store.update(id, { status: 'ready', error: null });
  }
  start(id: string) {
    if (this.repairJobs.has(id))
      throw Object.assign(new Error('成果正在复核，请稍后继续。'), { statusCode: 409 });
    const d = this.store.get(id);
    if (['running', 'pausing', 'ending', 'summarizing', 'completed'].includes(d.status)) return;
    if (!['ready', 'paused', 'error'].includes(d.status))
      throw Object.assign(new Error('当前状态不能开始讨论。'), { statusCode: 409 });
    this.ensureMode(d);
    if (d.rosterStale)
      throw Object.assign(new Error('阵容需要按新前提重新生成。'), { statusCode: 409 });
    if (this.store.participants(id).length !== d.expertCount + 1)
      throw Object.assign(new Error('嘉宾阵容不完整。'), { statusCode: 409 });
    const next = d.resumeStatus ?? 'running';
    this.store.update(id, {
      status: next,
      error: null,
      resumeStatus: null,
      runStartedAt: new Date().toISOString(),
    });
    this.launch(id);
  }
  pause(id: string) {
    const d = this.store.get(id);
    if (d.status === 'running') this.store.update(id, { status: 'pausing' });
    else if (!['pausing', 'paused'].includes(d.status))
      throw Object.assign(new Error('当前状态不能暂停。'), { statusCode: 409 });
  }
  end(id: string) {
    if (this.repairJobs.has(id))
      throw Object.assign(new Error('成果正在复核，请稍后操作。'), { statusCode: 409 });
    const d = this.store.get(id);
    if (['completed', 'summarizing', 'ending'].includes(d.status)) return;
    if (!['running', 'pausing', 'paused', 'error'].includes(d.status))
      throw Object.assign(new Error('请先开始讨论。'), { statusCode: 409 });
    this.ensureMode(d);
    this.store.update(id, {
      status: this.jobs.has(id) ? 'ending' : 'summarizing',
      resumeStatus: 'summarizing',
      error: null,
      endReason: 'user',
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
            ...clockStopped(d),
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
    const people = new Set(context.participants.map((p) => p.id));
    const schema = (person.role === 'expert' ? expertSpeechSchema : speechSchema)
      .transform((value) => ({
        ...value,
        replyTo: value.replyTo ? (aliases.get(value.replyTo) ?? value.replyTo) : null,
      }))
      .refine((v) => v.replyTo === null || ids.has(v.replyTo), {
        message: '引用或追问：replyTo必须为本场消息ID',
        path: ['replyTo'],
      })
      .refine((v) => v.addressedTo === null || people.has(v.addressedTo), {
        message: '引用或追问：addressedTo必须为本场角色ID',
        path: ['addressedTo'],
      });
    let corrections: ConsistencyIssue[] = [];
    let result!: import('zod').infer<typeof speechSchema>;
    let approved = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      result = await this.call(
        'speech',
        this.input(context, { current: person, directive, intent, corrections }),
        schema,
      );
      this.assertDirection(id, context.directionVersion);
      corrections = directConsistencyIssues(result.text, context);
      if (!corrections.length) {
        const refs = new Set([
          'topic',
          ...context.messages.map((m) => m.id),
          ...context.evidenceMemory.anchors.map((a) => a.messageId),
        ]);
        const review = await this.call(
          'review',
          this.input(context, {
            purpose: 'speech-boundary',
            candidate: result.text,
            speakerId: person.id,
          }),
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
        this.assertDirection(id, context.directionVersion);
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
        `发言仍存在范围、时间线或共识归因冲突，已暂停且未提交该发言。最近校验指出：${corrections[0]?.reason ?? '请澄清当前前提后重试。'}`,
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
        kind: 'speech',
        directionVersion: context.directionVersion,
      },
      cp,
      context.directionVersion,
    );
    this.store.activity(id, person.id, { state: 'idle', focus: person.focus });
  }
  private async updateInsights(id: string) {
    const old = this.store.insights(id);
    const context = this.context(id);
    const result = await this.call(
      'insights',
      context,
      insightSchema.refine((v) => {
        const ids = v.items.flatMap((i) => (i.id ? [i.id] : []));
        return (
          new Set(ids).size === ids.length &&
          v.items.every(
            (i) =>
              !i.id ||
              old.some((p) => p.id === i.id) ||
              context.knownIssues?.some((p) => p.id === i.id),
          ) &&
          v.resolvedDisputes.every((r) =>
            old.some((p) => p.id === r.id && p.kind === 'disagreement'),
          )
        );
      }, '沿用已有同类成果ID，关闭分歧必须引用已有分歧ID'),
    );
    this.assertDirection(id, context.directionVersion);
    const reviewed = await this.reviewLedger(id, result.items);
    this.assertDirection(id, context.directionVersion);
    const s = this.store.snapshot(id);
    const cp = this.store.checkpoint(id);
    cp.pendingInsight = null;
    cp.roundProgress = !!cp.roundProgress || result.progress;
    if (!cp.queue.length && cp.roundActive) {
      cp.noProgress = cp.roundProgress ? 0 : cp.noProgress + 1;
      cp.roundActive = false;
      cp.completedRounds = (cp.completedRounds ?? 0) + 1;
    }
    this.store.replaceInsights(id, reviewed.insights, result.contextSummary, cp, reviewed.ledger);
  }
  private settlePause(id: string) {
    if (this.store.get(id).status === 'pausing') {
      this.store.update(id, {
        status: 'paused',
        resumeStatus: 'running',
        ...clockStopped(this.store.get(id)),
      });
      this.store.resetActivities(id);
      return true;
    }
    return this.store.get(id).status === 'paused';
  }
  private async work(id: string) {
    const moderator = this.store.participants(id).find((p) => p.role === 'moderator')!;
    while (true) {
      try {
        let d = this.store.get(id);
        let cp = this.store.checkpoint(id);
        if (cp.pendingInsight) {
          await this.updateInsights(id);
          continue;
        }
        if (this.settlePause(id)) return;
        d = this.store.get(id);
        const turns = cycleTurns(d);
        const limits = limitsFor(d);
        const stalled =
          cp.noProgress >= (d.maxTurns <= 6 ? 2 : 3) &&
          (d.maxTurns <= 6 || turns >= limits.minTurns || turns === 0 || cp.noProgress >= 5);
        if (['ending', 'summarizing'].includes(d.status) || turns >= d.maxTurns || stalled) {
          await this.finish(
            id,
            moderator,
            d.endReason ?? (turns >= d.maxTurns ? 'turn_limit' : 'stalled'),
          );
          return;
        }
        if (d.status !== 'running') return;
        if ((d.handledDirectionVersion ?? 0) < (d.directionVersion ?? 0)) {
          const version = d.directionVersion ?? 0;
          await this.speak(
            id,
            moderator,
            `用户刚提交了新方向。请先确认当前焦点与有效前提，明确哪些边界保留、哪些由用户更新，然后围绕新方向提出一个具体问题。当前焦点：${d.focus ?? d.effectiveTopic ?? d.topic}`,
          );
          this.assertDirection(id, version);
          this.store.update(id, { handledDirectionVersion: version, phase: 'exchange' });
          continue;
        }
        const phase =
          d.maxTurns <= 6
            ? phaseFor(turns, d.maxTurns)
            : turns < d.expertCount
              ? 'exploration'
              : turns < limits.minTurns
                ? 'exchange'
                : 'convergence';
        if (d.phase !== phase) this.store.update(id, { phase });
        const hostAlreadySpoke = this.store
          .messages(id)
          .some(
            (m) =>
              m.participantId === moderator.id &&
              m.phase === phase &&
              m.seq >= (d.cycleStartSeq ?? 0),
          );
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
        const end = await this.assessConvergence(id);
        if (end) {
          await this.finish(id, moderator, end);
          return;
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
            const result = await this.call(
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
            this.assertDirection(id, context.directionVersion);
            this.store.activity(id, person.id, {
              state: result.apply ? 'preparing' : 'idle',
              focus: result.publicReason,
            });
            return {
              ...result,
              participantId: person.id,
              directionVersion: context.directionVersion,
              contextSeq: Math.max(0, ...context.messages.map((m) => m.seq)),
            };
          }),
        );
        this.assertDirection(id, context.directionVersion);
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
          Math.min(2, d.maxTurns - cycleTurns(d)),
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
        if (
          !cp.queue.length &&
          cp.noProgress < (d.maxTurns <= 6 ? 2 : 3) &&
          this.store.get(id).status === 'running'
        )
          await this.speak(
            id,
            moderator,
            '讨论暂时缺少新观点，请围绕未解决分歧追问一位专家，使用 addressedTo 指定对象。',
          );
      } catch (error) {
        if (error instanceof DirectionChanged) continue;
        if (error instanceof BoundaryStop) {
          await this.finish(id, moderator, error.reason, false);
          return;
        }
        throw error;
      }
    }
  }
  private async assessConvergence(id: string): Promise<EndReason | null> {
    const d = this.store.get(id);
    const cp = this.store.checkpoint(id);
    const turns = cycleTurns(d);
    const limits = limitsFor(d);
    if (
      turns < limits.minTurns ||
      turns - (cp.lastConvergenceTurns ?? 0) < 2 ||
      (d.directionVersion && d.turns - (d.directionStartTurns ?? 0) < Math.min(4, d.expertCount))
    )
      return null;
    const experts = this.store.participants(id).filter((p) => p.role === 'expert');
    const spoken = new Set(
      this.store
        .messages(id)
        .filter((m) => m.seq >= (d.cycleStartSeq ?? 0))
        .map((m) => m.participantId),
    );
    if (experts.some((p) => !spoken.has(p.id))) return null;
    // Reconcile stale labels before requiring the convergence verdict to carry
    // every still-open ID; otherwise a resolved issue can prevent closing.
    await this.closeConfirmedDisputes(id);
    this.assertDirection(id, d.directionVersion ?? 0);
    const context = this.context(id);
    const disputes = context.insights.filter((i) => i.kind === 'disagreement').map((i) => i.id);
    const result = await this.call(
      'convergence',
      context,
      convergenceSchema.refine(
        (v) => v.unresolvedIds.every((ref) => disputes.includes(ref)),
        '收束必须引用已有分歧ID',
      ),
    );
    this.assertDirection(id, context.directionVersion);
    const current = this.store.checkpoint(id);
    current.lastConvergenceTurns = turns;
    const ready =
      result.ready && result.reason !== 'needs_more' && !result.missingPerspectives.length;
    current.convergenceVotes = ready ? (current.convergenceVotes ?? 0) + 1 : 0;
    this.store.setCheckpoint(id, current);
    if (current.convergenceVotes >= 2 && this.store.get(id).status === 'running')
      return disputes.length ? 'stable_disagreement' : 'converged';
    return null;
  }
  private async reviewLedger(
    id: string,
    candidates: import('./schemas.js').InsightOutput['items'] = [],
    proposedResolutions: import('zod').infer<typeof insightSchema>['resolvedDisputes'] = [],
  ) {
    const snapshot = this.store.snapshot(id),
      context = this.context(id);
    const messages = snapshot.messages.filter(
      (m) => m.seq >= (snapshot.discussion.boundaryStartSeq ?? 0),
    );
    const aliases = new Map(context.evidenceMemory.anchors.map((a) => [a.id, a.messageId]));
    let ledger = ledgerFor(snapshot);
    let reviewed: ReturnType<typeof applyLedger> = {
      ledger,
      insights: snapshot.insights,
      audit: { seq: 0, accepted: [], closed: [], reopened: [], merged: [], rejected: [] },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const requiredReviewIds = ledger.records
        .filter((r) => !r.mergedInto && !r.verified)
        .map((r) => r.id);
      const output = await this.call(
        'ledger',
        this.input(context, {
          candidates,
          proposedResolutions,
          purpose:
            !candidates.length &&
            ledger.records.some((r) => !r.mergedInto && !r.verified && r.status === 'disagreement')
              ? 'legacy-migration'
              : 'incremental',
          knownIssues: ledgerDigest(ledger),
          requiredReviewIds,
          validationFeedback: reviewed.audit.rejected,
        }),
        ledgerSchema.transform((value) => ({
          decisions: value.decisions.map((item) => ({
            ...item,
            mergeIds: item.mergeIds ?? [],
            evidence: item.evidence.map((e) => ({
              ...e,
              messageId: aliases.get(e.messageId) ?? e.messageId,
            })),
          })),
        })),
      );
      this.assertDirection(id, context.directionVersion);
      const semantic = await this.call(
        'review',
        this.input(context, {
          purpose: 'ledger-grounding',
          knownIssues: ledgerDigest(ledger),
          ledgerCandidates: output.decisions,
          existingConsensus: ledger.records
            .filter((r) => r.status === 'consensus' && r.verified)
            .map((r) => ({ id: r.id, text: r.text, evidence: r.evidence })),
        }),
        reviewSchema,
      );
      this.assertDirection(id, context.directionVersion);
      const failures = semantic.issues;
      // Independently rejected published claims become unverified until corrected;
      // source history stays intact and omitted claims cannot silently reappear.
      for (const record of ledger.records) {
        if (record.status === 'consensus' && failures.some((f) => f.quote === record.text))
          record.verified = false;
      }
      const semanticRejected = output.decisions.filter((item) =>
        failures.some((f) => f.quote === item.text),
      );
      reviewed = applyLedger(
        ledger,
        ledgerSchema
          .parse(output)
          .decisions.filter((item) => !semanticRejected.some((r) => r.text === item.text)),
        messages,
        snapshot.participants,
        `${id}:${snapshot.discussion.boundaryStartSeq ?? 0}`,
      );
      for (const item of semanticRejected)
        reviewed.audit.rejected.push({
          issueId: item.issueId,
          reason:
            'semantic_grounding: ' +
            failures
              .filter((f) => f.quote === item.text)
              .map((f) => f.reason)
              .join('；'),
        });
      for (const record of ledger.records.filter((r) => r.status === 'consensus' && !r.verified)) {
        const reasons = failures.filter((f) => f.quote === record.text);
        if (reasons.length)
          reviewed.audit.rejected.push({
            issueId: record.id,
            reason: 'existing_claim_needs_correction: ' + reasons.map((f) => f.reason).join('；'),
          });
      }
      ledger = reviewed.ledger;
      this.log({
        discussionId: id,
        ledgerAccepted: reviewed.audit.accepted.length,
        ledgerClosed: reviewed.audit.closed.length,
        ledgerMerged: reviewed.audit.merged.length,
        ledgerRejected: reviewed.audit.rejected,
      });
      if (!reviewed.audit.rejected.length) break;
    }
    return reviewed;
  }
  private async closeConfirmedDisputes(id: string) {
    const snapshot = this.store.snapshot(id);
    if (
      !snapshot.insights.some((item) => item.kind === 'disagreement') &&
      !snapshot.discussion.insightLedger?.records.some((r) => r.status === 'question')
    )
      return;
    const reviewed = await this.reviewLedger(id);
    this.store.replaceInsights(
      id,
      reviewed.insights,
      snapshot.discussion.contextSummary,
      this.store.checkpoint(id),
      reviewed.ledger,
    );
  }
  async repairInsights(id: string) {
    if (this.repairJobs.has(id))
      throw Object.assign(new Error('成果正在复核。'), { statusCode: 409 });
    this.repairJobs.add(id);
    try {
      return await this.repairInsightsUnlocked(id);
    } finally {
      this.repairJobs.delete(id);
    }
  }
  private async repairInsightsUnlocked(id: string) {
    const before = this.store.snapshot(id),
      d = before.discussion;
    if (this.jobs.has(id) || !['completed', 'paused', 'error'].includes(d.status))
      throw Object.assign(new Error('请先暂停或结束讨论，再复核历史成果。'), { statusCode: 409 });
    if (d.source === 'curated')
      throw Object.assign(new Error('人工示例只供浏览。'), { statusCode: 409 });
    this.ensureMode(d);
    const reviewed = await this.reviewLedger(id);
    this.assertDirection(id, d.directionVersion ?? 0);
    const snapshot = {
      ...this.store.snapshot(id),
      insights: reviewed.insights,
      discussion: { ...this.store.get(id), insightLedger: reviewed.ledger },
    };
    const archivePatch =
      d.status === 'completed'
        ? {
            summaryHistory: [
              ...(d.summaryHistory ?? []),
              {
                cycle: d.cycle ?? 1,
                topic: d.effectiveTopic ?? d.topic,
                summary: d.summary ?? '',
                details: d.summaryDetails ?? null,
                createdAt: new Date().toISOString(),
                revisionReason: '成果复核前归档',
              },
            ],
            previousContexts: [
              ...(d.previousContexts ?? []),
              {
                version: d.directionVersion ?? 0,
                topic: d.effectiveTopic ?? d.topic,
                insights: before.insights,
                ledger: d.insightLedger,
                createdAt: new Date().toISOString(),
                reason: 'insight_repair',
              },
            ],
            summary: renderConciseSummary(snapshot, [], d.endReason ?? 'user'),
            summaryDetails: renderGroundedSummary(snapshot, []),
          }
        : {};
    this.store.replaceInsights(
      id,
      reviewed.insights,
      d.contextSummary,
      this.store.checkpoint(id),
      reviewed.ledger,
      archivePatch,
    );
    return this.store.snapshot(id);
  }
  private async finish(
    id: string,
    moderator: Participant,
    reason: EndReason = 'user',
    useModel = true,
  ) {
    const before = this.store.get(id);
    const version = before.directionVersion ?? 0;
    this.store.update(id, {
      status: 'summarizing',
      phase: 'closing',
      resumeStatus: 'summarizing',
      endReason: reason,
    });
    this.store.activity(id, moderator.id, {
      state: 'speaking',
      focus: '整理共识、保留分歧，并提出下一步建议。',
    });
    let highlights = this.store
      .messages(id)
      .filter((m) => m.seq >= (before.boundaryStartSeq ?? 0))
      .filter((m) =>
        this.store.participants(id).some((p) => p.id === m.participantId && p.role === 'expert'),
      )
      .slice(-2)
      .map((m) => m.id);
    if (
      useModel &&
      (before.modelCalls ?? 0) < limitsFor(before).maxModelCalls &&
      activeElapsed(before) < limitsFor(before).maxActiveMs
    ) {
      try {
        await this.closeConfirmedDisputes(id);
        if (
          reason === 'stable_disagreement' &&
          !this.store.insights(id).some((item) => item.kind === 'disagreement')
        )
          reason = 'converged';
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
            .filter(
              (m) => expertIds.has(m.participantId) && m.seq >= (before.boundaryStartSeq ?? 0),
            )
            .map((m) => m.id),
        );
        const result = await this.call(
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
        this.assertDirection(id, version);
        highlights = result.highlightMessageIds;
      } catch (error) {
        if (!(error instanceof BoundaryStop)) throw error;
      }
    }
    this.assertDirection(id, version);
    const snapshot = this.store.snapshot(id);
    this.store.update(
      id,
      {
        status: 'completed',
        summary: renderConciseSummary(snapshot, highlights, reason),
        summaryDetails: renderGroundedSummary(snapshot, highlights),
        endReason: reason,
        ...clockStopped(this.store.get(id)),
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
