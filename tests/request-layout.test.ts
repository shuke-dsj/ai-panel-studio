import { describe, it, expect } from 'vitest';
import { buildModelMessages } from '../server/request-layout.js';
import { prompts } from '../server/prompts.js';
import { usageMetadata } from '../server/usage.js';
import { buildContext } from '../server/context.js';
import { longDiscussion, criticalQuotes } from './fixtures/long-discussion.js';

describe('cacheable transport without context loss', () => {
  it('preserves evidence and role identity while reusing the compact transcript prefix across tasks', () => {
    const input = buildContext(longDiscussion(9), [], 56000);
    const first = buildModelMessages(
      'intent',
      { ...input, current: input.participants[1] },
      '',
      'compact',
    );
    const second = buildModelMessages(
      'speech',
      { ...input, current: input.participants[2] },
      '',
      'compact',
    );
    expect(second.slice(0, 2)).toEqual(first.slice(0, 2));
    const [header, ...lines] = first[1].content.split('\n');
    const tail = JSON.parse(lines.pop()!.slice('SNAPSHOT '.length));
    expect(JSON.parse(header).participants).toEqual(input.participants);
    expect(JSON.parse(first[3].content).current).toEqual({ id: input.participants[1].id });
    expect(tail.evidenceMemory).toEqual(input.evidenceMemory);
    expect(tail.insights).toEqual(input.insights);
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      input.messages.map(({ discussionId, createdAt, ...m }) => m),
    );
    const extended = buildModelMessages(
      'speech',
      { ...input, messages: [...input.messages, { ...input.messages[0], id: 'new', seq: 10 }] },
      '',
      'compact',
    );
    expect(extended[1].content.startsWith(first[1].content.split('SNAPSHOT ')[0])).toBe(true);
  });
  it('preserves opaque JSON keys without treating __proto__ as an assignment to the transport prototype', () => {
    const input = JSON.parse(
      '{"topic":"测试","messages":[],"__proto__":{"polluted":true},"constructor":"opaque"}',
    );
    const messages = buildModelMessages('summary', input);
    expect({ ...JSON.parse(messages[1].content), ...JSON.parse(messages[3].content) }).toEqual(
      input,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('preserves every JSON value, source, condition and mutable field across two material blocks', () => {
    const input = {
      ...buildContext(longDiscussion(24), [], 56000),
      current: { id: 'b', role: 'expert' },
      purpose: 'speech-boundary',
      candidate: '待审查原话',
      unknownFutureField: { version: 7, values: [3, 1, 2] },
    };
    const original = JSON.stringify(input);
    const request = buildModelMessages('review', input);
    expect({ ...JSON.parse(request[1].content), ...JSON.parse(request[3].content) }).toEqual(input);
    expect(request[2]).toEqual({ role: 'system', content: prompts.review });
    expect(
      request.filter((m) => m.role === 'user').every((m) => !m.content.includes(prompts.review)),
    ).toBe(true);
    expect(JSON.stringify(input)).toBe(original);
    for (const quote of criticalQuotes) expect(request[1].content).toContain(quote);
  });
  it('shares same-revision evidence and ledger material but invalidates their changed values after preserved history', () => {
    const context = {
      ...buildContext(longDiscussion(12), [], 56000),
      knownIssues: [{ id: 'q1', status: 'disagreement' }],
    };
    const a = buildModelMessages('intent', { ...context, current: { id: 'a' } });
    const b = buildModelMessages('ledger', { ...context, purpose: 'incremental', candidates: [] });
    expect(a.slice(0, 2)).toEqual(b.slice(0, 2));
    expect(JSON.parse(a[1].content).knownIssues).toEqual(context.knownIssues);
    const changed = buildModelMessages('ledger', {
      ...context,
      knownIssues: [{ id: 'q1', status: 'resolved' }],
    });
    expect(changed[1].content).not.toBe(a[1].content);
    expect(changed[1].content.split(',"knownIssues":')[0]).toBe(
      a[1].content.split(',"knownIssues":')[0],
    );
    expect(JSON.parse(changed[1].content).knownIssues[0].status).toBe('resolved');
  });
  it('reuses the same prefix across roles, tasks, stage changes and retries without freezing live state', () => {
    const context = buildContext(longDiscussion(12), [], 56000);
    const a = buildModelMessages('intent', {
      ...context,
      current: { id: 'a' },
      phase: '展开',
      turns: 2,
    });
    const b = buildModelMessages(
      'review',
      {
        ...context,
        current: { id: 'b' },
        phase: '交叉',
        turns: 3,
        activeFocus: '回退',
        directionVersion: 2,
      },
      '重新生成JSON',
    );
    expect(b.slice(0, 2)).toEqual(a.slice(0, 2));
    expect(JSON.parse(b[3].content)).toMatchObject({
      current: { id: 'b' },
      turns: 3,
      activeFocus: '回退',
      directionVersion: 2,
    });
    expect(b[2].content).toBe(prompts.review + '重新生成JSON');
    expect(b[2]).not.toEqual(a[2]);
  });
  it('keeps object serialization stable but never sorts transcript or evidence arrays', () => {
    const a = {
      topic: '议题',
      messages: [
        { seq: 2, text: '后话', id: 'b' },
        { seq: 1, text: '原话', id: 'a' },
      ],
      current: { id: 'b', focus: 'x' },
    };
    const b = {
      current: { focus: 'x', id: 'b' },
      messages: [
        { id: 'b', text: '后话', seq: 2 },
        { id: 'a', text: '原话', seq: 1 },
      ],
      topic: '议题',
    };
    expect(buildModelMessages('speech', a)).toEqual(buildModelMessages('speech', b));
    expect(
      JSON.parse(buildModelMessages('speech', a)[1].content).messages.map((m: any) => m.id),
    ).toEqual(['b', 'a']);
  });
  it('extends history at its end and invalidates shared material on changed scope or participants', () => {
    const input = {
      discussionId: 'd',
      topic: '仅非敏感',
      participants: [{ id: 'a' }],
      messages: [{ id: 'm1', text: '必须暂停' }],
    };
    const a = buildModelMessages('intent', input)[1].content;
    const b = buildModelMessages('intent', {
      ...input,
      messages: [...input.messages, { id: 'm2', text: '我反对' }],
    })[1].content;
    expect(b.startsWith(a.slice(0, -2))).toBe(true); // Only the closing array/object changes.
    expect(buildModelMessages('intent', { ...input, topic: '替换前提' })[1].content).not.toBe(a);
    expect(
      buildModelMessages('intent', { ...input, participants: [{ id: 'other' }] })[1].content,
    ).not.toBe(a);
  });
  it('preserves protected evidence from compressed long histories in the transmitted data', () => {
    const context = buildContext(longDiscussion(600), [], 12000);
    const request = buildModelMessages('retention', context);
    const restored = { ...JSON.parse(request[1].content), ...JSON.parse(request[3].content) };
    expect(restored).toEqual(context);
    for (const quote of criticalQuotes)
      expect(restored.evidenceMemory.anchors.some((a: any) => a.quote === quote)).toBe(true);
    expect(restored.insights.some((i: any) => i.id === 'audit-dispute')).toBe(true);
  });
});
describe('cache usage telemetry', () => {
  it('keeps provider hit/miss counts including a genuine zero hit, omitting unrelated usage fields', () => {
    const result = usageMetadata({
      prompt_tokens: 1000,
      completion_tokens: 25,
      total_tokens: 1025,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1000,
      private: 'hidden',
    });
    expect(result.cache).toEqual({
      status: 'reported',
      hitTokens: 0,
      missTokens: 1000,
      hitRate: 0,
    });
    expect(result.usage).not.toHaveProperty('private');
  });
  it('supports compatible cached_tokens without forwarding other nested provider data', () => {
    const result = usageMetadata({
      prompt_tokens: 1000,
      prompt_tokens_details: { cached_tokens: 800, private: 'hidden' },
    });
    expect(result.cache).toEqual({
      status: 'reported',
      hitTokens: 800,
      missTokens: 200,
      hitRate: 0.8,
    });
    expect(result.usage.prompt_tokens_details).toEqual({ cached_tokens: 800 });
  });
  it('does not treat missing, invalid or inconsistent metrics as a measured cache hit rate', () => {
    expect(usageMetadata({ prompt_tokens: 1000 }).cache).toEqual({ status: 'not_reported' });
    expect(
      usageMetadata({ prompt_cache_hit_tokens: -1, prompt_cache_miss_tokens: NaN }).usage,
    ).toEqual({});
    expect(
      usageMetadata({
        prompt_tokens: 1000,
        prompt_cache_hit_tokens: 1200,
        prompt_cache_miss_tokens: 200,
      }).cache,
    ).not.toHaveProperty('hitRate');
  });
});
