import { describe, it, expect } from 'vitest';
import type { ZodType } from 'zod';
import type { Model } from '../server/model.js';
import { ModelError } from '../server/model.js';
import type { Task } from '../server/prompts.js';
import { DemoModel } from '../server/demo-model.js';
import { Store } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { seedCurated } from '../server/seed.js';

class ControlledModel implements Model {
  mode = 'demo' as const;
  configured = true;
  delegate = new DemoModel(0);
  inputs: { task: Task; input: any }[] = [];
  fail: Task | null = null;
  abstain = false;
  stagnant = false;
  onCall: ((task: Task, input: any) => void) | null = null;
  async run<T>(task: Task, input: unknown, schema: ZodType<T>): Promise<T> {
    this.inputs.push({ task, input });
    this.onCall?.(task, input);
    if (this.fail === task) throw new ModelError('INJECTED', '测试失败');
    if (this.abstain && task === 'intent')
      return schema.parse({
        apply: false,
        kind: 'raise',
        replyTo: null,
        urgency: 0,
        publicReason: '暂无新观点',
      });
    const result = await this.delegate.run(task, input, schema);
    return this.stagnant && task === 'insights'
      ? schema.parse({ ...(result as object), progress: false })
      : result;
  }
}
async function setup() {
  const store = new Store(':memory:');
  const model = new ControlledModel();
  const engine = new Engine(store, model);
  const d = store.create('讨论系统如何安全上线', 4, 6, 'test');
  await engine.generate(d.id);
  engine.confirm(d.id);
  return { store, model, engine, id: d.id };
}

describe('durable discussion engine', () => {
  it('prevents a service mode switch from relabeling demo output as real', async () => {
    const { store, model, id } = await setup();
    const real: Model = { mode: 'real', configured: true, run: model.run.bind(model) };
    const engine = new Engine(store, real);
    expect(() => engine.start(id)).toThrow('模式');
    expect(store.get(id).status).toBe('ready');
    const live = store.create('真实讨论', 2, 6, 'live');
    await expect(new Engine(store, model).generate(live.id)).rejects.toThrow('模式');
    expect(store.get(live.id).status).toBe('draft');
    store.close();
  });
  it('concludes after two rounds of speeches with no substantive progress', async () => {
    const { store, model, engine, id } = await setup();
    model.stagnant = true;
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).status).toBe('completed');
    expect(store.get(id).turns).toBe(4);
    expect(store.checkpoint(id).noProgress).toBe(2);
    store.close();
  });
  it('completes the bounded conversation, keeps same-revision intents, updates second speaker context', async () => {
    const { store, model, engine, id } = await setup();
    engine.start(id);
    engine.start(id);
    await engine.wait(id);
    const s = store.snapshot(id);
    expect(s.discussion.status).toBe('completed');
    expect(s.discussion.turns).toBe(6);
    expect(s.discussion.summary).not.toMatch(/^\{/);
    expect(s.insights.some((i) => i.kind === 'consensus')).toBe(true);
    const expertSpeeches = model.inputs.filter(
      (c) => c.task === 'speech' && c.input.current.role === 'expert',
    );
    expect(expertSpeeches[1].input.messages.length).toBeGreaterThan(
      expertSpeeches[0].input.messages.length,
    );
    const intents = model.inputs.filter((c) => c.task === 'intent').slice(0, 4);
    expect(new Set(intents.map((c) => JSON.stringify(c.input.messages))).size).toBe(1);
    expect(s.messages.some((m) => m.phase === 'exchange')).toBe(true);
    expect(s.messages.some((m) => m.phase === 'convergence')).toBe(true);
    expect(store.events(id, 0).filter((e) => e.type === 'completed')).toHaveLength(1);
    store.close();
  });
  it('commits current speech before pausing and resumes without duplicate messages', async () => {
    const { store, model, engine, id } = await setup();
    let paused = false;
    model.onCall = (task, input) => {
      if (!paused && task === 'speech' && input.current.role === 'expert') {
        paused = true;
        engine.pause(id);
      }
    };
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).status).toBe('paused');
    expect(store.get(id).turns).toBe(1);
    expect(store.checkpoint(id).pendingInsight).toBeNull();
    const before = store.messages(id).map((m) => m.id);
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).turns).toBe(6);
    expect(
      store
        .messages(id)
        .slice(0, before.length)
        .map((m) => m.id),
    ).toEqual(before);
    store.close();
  });
  it('retries pending insights instead of generating another speech after failure', async () => {
    const { store, model, engine, id } = await setup();
    model.fail = 'insights';
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).status).toBe('error');
    expect(store.get(id).turns).toBe(1);
    expect(store.checkpoint(id).pendingInsight).toBeTruthy();
    const committed = store.messages(id).map((m) => m.id);
    model.fail = null;
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).status).toBe('completed');
    expect(
      store
        .messages(id)
        .slice(0, committed.length)
        .map((m) => m.id),
    ).toEqual(committed);
    store.close();
  });
  it('ends after current speech, supports summary retries, never emits duplicate completion', async () => {
    const { store, model, engine, id } = await setup();
    let stopped = false;
    model.onCall = (task, input) => {
      if (!stopped && task === 'speech' && input.current.role === 'expert') {
        stopped = true;
        engine.end(id);
        engine.end(id);
      }
    };
    model.fail = 'summary';
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).turns).toBe(1);
    expect(store.get(id).resumeStatus).toBe('summarizing');
    model.fail = null;
    engine.start(id);
    await engine.wait(id);
    engine.end(id);
    expect(store.get(id).status).toBe('completed');
    expect(store.events(id, 0).filter((e) => e.type === 'completed')).toHaveLength(1);
    store.close();
  });
  it('concludes after two empty rounds with a moderator follow-up', async () => {
    const { store, model, engine, id } = await setup();
    model.abstain = true;
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).status).toBe('completed');
    expect(store.get(id).turns).toBe(0);
    expect(store.messages(id)).toHaveLength(2);
    store.close();
  });
  it('keeps old roster when regeneration fails and locks confirmed roster', async () => {
    const store = new Store(':memory:');
    const model = new ControlledModel();
    const engine = new Engine(store, model);
    const d = store.create('test', 4, 6, 'test');
    await engine.generate(d.id);
    const ids = store.participants(d.id).map((p) => p.id);
    model.fail = 'roster';
    await expect(engine.generate(d.id)).rejects.toThrow();
    expect(store.participants(d.id).map((p) => p.id)).toEqual(ids);
    expect(store.get(d.id).status).toBe('roster_ready');
    engine.confirm(d.id);
    model.fail = null;
    await expect(engine.generate(d.id)).rejects.toThrow('确认后');
    store.close();
  });
  it('runs simultaneous discussions without cross-context leakage', async () => {
    const { store, model, engine, id } = await setup();
    const other = store.create('完全不同的成本问题', 2, 6, 'test');
    await engine.generate(other.id);
    engine.confirm(other.id);
    engine.start(id);
    engine.start(other.id);
    await Promise.all([engine.wait(id), engine.wait(other.id)]);
    for (const target of [id, other.id]) {
      const s = store.snapshot(target);
      const ids = new Set(s.participants.map((p) => p.id));
      expect(s.messages.every((m) => m.discussionId === target && ids.has(m.participantId))).toBe(
        true,
      );
      expect(store.events(target, 0).every((e) => e.discussionId === target)).toBe(true);
    }
    expect(
      model.inputs
        .filter((c) => c.task === 'intent')
        .every((c) =>
          c.input.messages.every((m: any) => m.discussionId === c.input.current.discussionId),
        ),
    ).toBe(true);
    store.close();
  });
  it('recovers a persisted queue to paused and can continue without losing it', async () => {
    const { store, engine, id } = await setup();
    store.update(id, { status: 'running' });
    const cp = store.checkpoint(id);
    cp.queue = [
      {
        participantId: store.participants(id)[1].id,
        apply: true,
        kind: 'raise',
        replyTo: null,
        urgency: 1,
        publicReason: '恢复测试',
      },
    ];
    store.setCheckpoint(id, cp);
    store.recover();
    expect(store.get(id).status).toBe('paused');
    expect(store.checkpoint(id).queue).toHaveLength(1);
    engine.start(id);
    await engine.wait(id);
    expect(store.get(id).status).toBe('completed');
    store.close();
  });
  it('seeds five distinct curated examples idempotently with linked evidence', () => {
    const store = new Store(':memory:');
    seedCurated(store);
    seedCurated(store);
    expect(store.list()).toHaveLength(5);
    for (const d of store.list()) {
      expect(d.source).toBe('curated');
      expect(store.participants(d.id)).toHaveLength(5);
      const ids = new Set(store.messages(d.id).map((m) => m.id));
      expect(store.insights(d.id).every((i) => i.messageIds.every((id) => ids.has(id)))).toBe(true);
    }
    store.close();
  });
});
