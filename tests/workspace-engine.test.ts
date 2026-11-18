import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import type { Task } from '../server/prompts.js';
import type { Model } from '../server/model.js';
import { DemoModel } from '../server/demo-model.js';
import { Store } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { refreshArchivedSummary } from '../server/refresh-summary.js';

class ProbeModel implements Model {
  mode = 'demo' as const;
  configured = true;
  delegate = new DemoModel(0);
  inputs: { task: Task; data: any }[] = [];
  hook?: (task: Task, data: any) => Promise<void> | void;
  async run<T>(
    task: Task,
    input: unknown,
    schema: ZodType<T>,
    options?: { onAttempt?: (attempt: number) => void },
  ): Promise<T> {
    this.inputs.push({ task, data: input });
    await this.hook?.(task, input);
    return this.delegate.run(task, input, schema, options);
  }
}
async function setup(maxTurns = 48) {
  const store = new Store(':memory:'),
    model = new ProbeModel(),
    engine = new Engine(store, model);
  const d = store.create('仅非敏感文档的2周验证，权限失败必须暂停', 4, maxTurns, 'test');
  await engine.generate(d.id);
  engine.confirm(d.id);
  return { store, model, engine, id: d.id };
}
describe('interactive concurrent workspace engine', () => {
  it('excludes revoked closure candidates when locally refreshing an archive without consuming model budget', async () => {
    const { store, engine, id } = await setup(6);
    try {
      engine.start(id);
      await engine.wait(id);
      const before = store.snapshot(id),
        ledger = before.discussion.insightLedger!;
      const item = ledger.records.find((r) => r.status === 'consensus')!;
      item.verified = false;
      item.closedAtSeq = 6;
      store.replaceInsights(
        id,
        before.insights,
        before.discussion.contextSummary,
        store.checkpoint(id),
        ledger,
      );
      const refreshed = refreshArchivedSummary(store, id);
      expect(refreshed.insights.some((i) => i.id === item.id)).toBe(false);
      expect(refreshed.discussion.summary).toContain('已关闭0项');
      expect(refreshed.discussion.modelCalls).toBe(before.discussion.modelCalls);
      expect(refreshed.messages).toEqual(before.messages);
      expect(store.events(id, 0).filter((e) => e.type === 'completed')).toHaveLength(1);
      const cursor = store.cursor(id);
      refreshArchivedSummary(store, id);
      expect(store.cursor(id)).toBe(cursor);
    } finally {
      store.close();
    }
  });
  it('repairs archived outcomes atomically while preserving the original summary, transcript and completion event', async () => {
    const { store, model, engine, id } = await setup(6);
    try {
      engine.start(id);
      await engine.wait(id);
      const before = store.snapshot(id);
      const run = model.run.bind(model);
      model.run = async (task, input, schema, options) =>
        task === 'ledger' ? schema.parse({ decisions: [] }) : run(task, input, schema, options);
      await engine.repairInsights(id);
      const after = store.snapshot(id);
      expect(after.messages).toEqual(before.messages);
      expect(after.insights).toEqual(before.insights);
      expect(after.discussion.summaryHistory?.at(-1)?.summary).toBe(before.discussion.summary);
      expect(after.discussion.previousContexts?.at(-1)?.ledger).toEqual(
        before.discussion.insightLedger,
      );
      expect(store.events(id, 0).filter((e) => e.type === 'completed')).toHaveLength(1);
      expect(after.discussion.insightLedger).toBeDefined();
    } finally {
      store.close();
    }
  });
  it('keeps every stored dispute when the model only echoes a subset of IDs in its convergence verdict', async () => {
    const { store, model, engine, id } = await setup(16);
    try {
      const run = model.run.bind(model);
      model.run = async (task, input, schema, options) =>
        task === 'convergence'
          ? schema.parse({
              ready: true,
              reason: 'covered',
              unresolvedIds: [],
              missingPerspectives: [],
            })
          : run(task, input, schema, options);
      engine.start(id);
      await engine.wait(id);
      expect(store.get(id).status).toBe('completed');
      expect(store.get(id).endReason).toBe('stable_disagreement');
      const disputes = store.insights(id).filter((item) => item.kind === 'disagreement');
      expect(disputes.length).toBeGreaterThan(0);
      for (const item of disputes) expect(store.get(id).summaryDetails).toContain(item.text);
    } finally {
      store.close();
    }
  });
  it('reconciles proven stale disputes before archiving without deleting original messages or events', async () => {
    const { store, model, engine, id } = await setup(16);
    try {
      const experts = store
        .participants(id)
        .filter((p) => p.role === 'expert')
        .slice(0, 2);
      const messages = experts.map((p) =>
        store.message(id, {
          participantId: p.id,
          text: '我接受将该条件列为待用户批准的建议。',
          phase: 'convergence',
          replyTo: null,
          addressedTo: null,
        }),
      );
      const dispute = {
        id: 'stale-condition',
        kind: 'disagreement' as const,
        text: '双方是否同意只列为待批准建议仍待确认',
        messageIds: messages.map((m) => m.id),
        positions: experts.map((p) => ({ participantId: p.id, view: '待确认' })),
      };
      store.replaceInsights(id, [dispute], '待确认记录', store.checkpoint(id));
      store.update(id, { status: 'paused' });
      const originalRun = model.run.bind(model);
      model.run = async (task, input, schema, options) =>
        task === 'ledger'
          ? schema.parse({
              decisions: [
                {
                  issueId: dispute.id,
                  mergeIds: [],
                  question: '建议是否已获批准',
                  text: '双方接受仅列为待批准建议',
                  status: 'resolved',
                  complete: true,
                  evidence: messages.map((m) => ({
                    messageId: m.id,
                    quote: m.text,
                    stance: 'accept',
                    supportsClaim: true,
                    view: '仅为待批准建议',
                  })),
                },
              ],
            })
          : originalRun(task, input, schema, options);
      engine.end(id);
      await engine.wait(id);
      expect(store.get(id).status).toBe('completed');
      expect(store.get(id).endReason).toBe('user');
      expect(store.insights(id)).toEqual([]);
      expect(store.messages(id)).toEqual(messages);
      expect(store.events(id, 0).filter((e) => e.type === 'insights')).toHaveLength(2);
      expect(store.get(id).summaryDetails).toContain(messages[0].text);
    } finally {
      store.close();
    }
  });
  it('does not publish a common claim when semantic review rejects its phase attribution despite literal quotes', async () => {
    const { store, model, engine, id } = await setup(6);
    try {
      const run = model.run.bind(model);
      let reviewed = 0;
      model.run = async (task, input, schema, options) => {
        const data = input as any;
        if (task === 'review' && data.purpose === 'ledger-grounding') {
          reviewed++;
          return schema.parse({
            issues: data.ledgerCandidates
              .filter((item: any) => item.status === 'consensus')
              .map((item: any) => ({
                kind: 'consensus',
                quote: item.text,
                reason: '角色分离不能证明同意指定期限。',
                conflictsWith: [item.evidence[0].messageId],
              })),
          });
        }
        return run(task, input, schema, options);
      };
      engine.start(id);
      await engine.wait(id);
      expect(reviewed).toBeGreaterThan(0);
      expect(store.get(id).status).toBe('completed');
      expect(store.insights(id).some((item) => item.kind === 'consensus')).toBe(false);
      expect(store.insights(id).some((item) => item.kind === 'disagreement')).toBe(true);
      expect(store.get(id).summary).not.toContain('全员一致');
    } finally {
      store.close();
    }
  });
  it('does not ignore a direction arriving at the turn boundary before final analysis finishes', async () => {
    const { store, model, engine, id } = await setup(6);
    try {
      let renewed = false;
      model.hook = (task) => {
        if (!renewed && task === 'insights' && store.get(id).turns === 6) {
          renewed = true;
          engine.steer(id, '边界时刻提出新的回退问题', 'focus', randomUUID());
        }
      };
      engine.start(id);
      await engine.wait(id);
      expect(renewed).toBe(true);
      expect(store.get(id).cycle).toBe(2);
      expect(store.get(id).handledDirectionVersion).toBe(1);
      expect(store.get(id).turns).toBe(12);
      expect(store.get(id).status).toBe('completed');
    } finally {
      store.close();
    }
  });
  it('evaluates the same immutable revision concurrently, publishes fresh context sequentially, and converges beyond six speeches', async () => {
    const { store, model, engine, id } = await setup();
    try {
      let arrivals = 0,
        release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      model.hook = async (task) => {
        if (task === 'intent' && arrivals < 4) {
          arrivals++;
          if (arrivals === 4) release();
          await barrier;
        }
      };
      engine.start(id);
      await engine.wait(id);
      const s = store.snapshot(id),
        batch = model.inputs.filter((i) => i.task === 'intent').slice(0, 4);
      expect(arrivals).toBe(4);
      expect(new Set(batch.map((i) => JSON.stringify(i.data.messages))).size).toBe(1);
      const speeches = model.inputs.filter(
        (i) => i.task === 'speech' && i.data.current.role === 'expert',
      );
      expect(speeches[1].data.messages.length).toBeGreaterThan(speeches[0].data.messages.length);
      expect(s.discussion.status).toBe('completed');
      expect(s.discussion.turns).toBeGreaterThan(6);
      expect(s.discussion.turns).toBeLessThan(48);
      expect(s.discussion.endReason).toBe('stable_disagreement');
      expect(model.inputs.filter((i) => i.task === 'convergence')).toHaveLength(2);
      const sequence = s.messages
        .filter((m) => s.participants.find((p) => p.id === m.participantId)?.role === 'expert')
        .map((m) => m.participantId);
      expect(new Set(sequence).size).toBe(4);
      expect(sequence.slice(0, 4)).not.toEqual(
        s.participants.filter((p) => p.role === 'expert').map((p) => p.id),
      );
      expect(
        new Set(
          model.inputs
            .filter((i) => i.task === 'speech' && i.data.intent)
            .map((i) => i.data.intent.kind),
        ).size,
      ).toBeGreaterThanOrEqual(3);
    } finally {
      store.close();
    }
  });

  it.each(['intent', 'speech', 'insights'] as const)(
    'discards stale %s results after a live direction update',
    async (stage) => {
      const { store, model, engine, id } = await setup(6);
      try {
        let changed = false,
          obsoleteText = '';
        model.hook = (task, data) => {
          if (
            !changed &&
            task === stage &&
            (stage !== 'speech' || data.current.role === 'expert')
          ) {
            changed = true;
            if (stage === 'speech') obsoleteText = 'obsolete candidate';
            engine.steer(
              id,
              '重点讨论退出条件与人工回退，原非敏感和2周前提不变。',
              'focus',
              randomUUID(),
            );
          }
        };
        engine.start(id);
        await engine.wait(id);
        const s = store.snapshot(id),
          direction = s.messages.find((m) => m.kind === 'direction')!;
        expect(changed).toBe(true);
        expect(s.discussion.status).toBe('completed');
        expect(s.discussion.handledDirectionVersion).toBe(1);
        expect(
          s.messages.filter((m) => m.seq > direction.seq).every((m) => m.directionVersion === 1),
        ).toBe(true);
        expect(s.messages.filter((m) => m.kind === 'direction')).toHaveLength(1);
        expect(s.messages.some((m) => m.text === obsoleteText)).toBe(false);
        expect(store.events(id, 0).filter((e) => e.type === 'completed')).toHaveLength(1);
        expect(engine.context(id).activeFocus).toContain('退出条件');
      } finally {
        store.close();
      }
    },
  );

  it('locks an outdated roster after replacing premises during regeneration', async () => {
    const store = new Store(':memory:'),
      model = new ProbeModel(),
      engine = new Engine(store, model);
    try {
      const d = store.create('旧议题', 2, 48, 'test');
      await engine.generate(d.id);
      let changed = false;
      model.hook = (task) => {
        if (task === 'roster' && !changed) {
          changed = true;
          engine.steer(d.id, '新的离线检索议题', 'replace', randomUUID());
        }
      };
      await engine.generate(d.id);
      expect(store.get(d.id).rosterStale).toBe(true);
      expect(() => engine.confirm(d.id)).toThrow('重新生成');
      await engine.generate(d.id);
      engine.confirm(d.id);
      expect(store.get(d.id).status).toBe('ready');
      expect(model.inputs.at(-1)!.data.topic).toBe('新的离线检索议题');
    } finally {
      store.close();
    }
  });

  it('reopens a completed conversation without overwriting its prior summary or messages', async () => {
    const { store, engine, id } = await setup(6);
    try {
      engine.start(id);
      await engine.wait(id);
      const original = store.snapshot(id),
        request = randomUUID();
      engine.steer(id, '再评审部署成本，保留原范围。', 'focus', request);
      engine.steer(id, '再评审部署成本，保留原范围。', 'focus', request);
      await engine.wait(id);
      const next = store.snapshot(id);
      expect(next.discussion.cycle).toBe(2);
      expect(next.discussion.summaryHistory).toHaveLength(1);
      expect(next.discussion.summaryHistory![0].summary).toBe(original.discussion.summary);
      expect(next.messages.slice(0, original.messages.length)).toEqual(original.messages);
      expect(next.discussion.turns).toBe(12);
      expect(next.messages.filter((m) => m.kind === 'direction')).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('ends honestly at the active time budget without another provider call', async () => {
    const { store, engine, model, id } = await setup();
    try {
      model.hook = (task) => {
        if (task === 'intent') store.update(id, { activeMs: 26 * 60000 });
      };
      engine.start(id);
      await engine.wait(id);
      expect(store.get(id).endReason).toBe('time_limit');
      expect(store.get(id).status).toBe('completed');
      expect(model.inputs.some((i) => i.task === 'summary')).toBe(false);
    } finally {
      store.close();
    }
  });
});
