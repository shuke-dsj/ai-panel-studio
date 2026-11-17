import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { DemoModel } from '../server/demo-model.js';
import { buildContext } from '../server/context.js';

describe('discussion evidence and execution boundaries', () => {
  it('preserves focus constraints, isolates replaced premises and rejects stale commits', async () => {
    const store = new Store(':memory:');
    try {
      const engine = new Engine(store, new DemoModel(0));
      const d = store.create('只读、非敏感文档的2周试点', 2, 6, 'test');
      await engine.generate(d.id);
      const person = store.participants(d.id).find((p) => p.role === 'expert')!;
      store.message(
        d.id,
        {
          participantId: person.id,
          text: '必须低于4人时，否则退出。',
          phase: 'exchange',
          replyTo: null,
          addressedTo: null,
        },
        store.checkpoint(d.id),
        0,
      );
      const request = randomUUID();
      store.steer(d.id, '重点讨论维护成本', 'focus', request);
      store.steer(d.id, '重点讨论维护成本', 'focus', request);
      expect(store.get(d.id).directionVersion).toBe(1);
      const focused = buildContext(store.snapshot(d.id), [], 12000);
      expect(focused.topic).toBe(d.topic);
      expect(focused.evidenceMemory.anchors.some((a) => a.quote.includes('4人时'))).toBe(true);
      store.steer(d.id, '改为只评审本地离线搜索，不做RAG试点。', 'replace', randomUUID());
      const replaced = buildContext(store.snapshot(d.id), [], 12000);
      expect(replaced.topic).toContain('离线搜索');
      expect(replaced.messages.every((m) => m.kind === 'direction')).toBe(true);
      expect(replaced.evidenceMemory.anchors.some((a) => a.quote.includes('4人时'))).toBe(false);
      expect(store.messages(d.id).some((m) => m.text.includes('4人时'))).toBe(true);
      expect(() =>
        store.message(
          d.id,
          {
            participantId: person.id,
            text: '旧方向的候选不得提交。',
            phase: 'exchange',
            replyTo: null,
            addressedTo: null,
          },
          store.checkpoint(d.id),
          1,
        ),
      ).toThrow('方向版本');
    } finally {
      store.close();
    }
  });

  it('ends with an explicit model budget reason and archives original conditions', async () => {
    const store = new Store(':memory:');
    try {
      const engine = new Engine(store, new DemoModel(0));
      const d = store.create('非敏感文档2周试点', 2, 20, 'test', { maxModelCalls: 12 });
      await engine.generate(d.id);
      engine.confirm(d.id);
      engine.start(d.id);
      await engine.wait(d.id);
      const s = store.snapshot(d.id);
      expect(s.discussion.status).toBe('completed');
      expect(s.discussion.endReason).toBe('model_budget');
      expect(s.discussion.modelCalls).toBeLessThanOrEqual(12);
      expect(s.discussion.summary).toContain('预算');
      expect(s.discussion.summaryDetails).toContain(d.topic);
      expect(s.discussion.summary).not.toContain('已达成一致');
    } finally {
      store.close();
    }
  });
});
