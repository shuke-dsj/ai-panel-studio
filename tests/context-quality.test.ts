import { describe, it, expect } from 'vitest';
import { longDiscussion, criticalQuotes } from './fixtures/long-discussion.js';
import { buildContext, ContextBudgetError } from '../server/context.js';
import { extractEvidenceMemory } from '../server/memory.js';
import { renderGroundedSummary, renderConciseSummary } from '../server/summary.js';
import { directConsistencyIssues, hasUniversalAgreement } from '../server/consistency.js';
import { reconcileInsights } from '../server/scheduler.js';
describe('loss-aware context compression', () => {
  it.each([40, 180, 600])(
    'keeps early negative conditions, timelines and unresolved disputes over %i messages',
    (count) => {
      const s = longDiscussion(count);
      const original = JSON.stringify(s);
      const result = buildContext(s, [], 12000);
      const encoded = JSON.stringify(result);
      expect(result.compression.inputChars).toBe(encoded.length);
      expect(encoded.length).toBeLessThanOrEqual(10000);
      expect(result.omittedMessageCount).toBeGreaterThan(0);
      for (const quote of criticalQuotes)
        expect(result.evidenceMemory.anchors.some((a) => a.quote === quote)).toBe(true);
      expect(result.insights.find((i) => i.id === 'audit-dispute')).toEqual(s.insights[1]);
      expect(
        result.messages.some(
          (m) => m.id === s.messages.at(-1)!.id && m.text === s.messages.at(-1)!.text,
        ),
      ).toBe(true);
      expect(result.messages.some((m) => m.id === 'm2')).toBe(true);
      expect(JSON.stringify(s)).toBe(original);
    },
  );
  it('uses original evidence when a rolling summary omits or reverses a condition', () => {
    const s = longDiscussion();
    s.discussion.contextSummary = '全员同意接入敏感库，试点统一改为4周。';
    const c = buildContext(s, [], 12000);
    expect(c.evidenceMemory.anchors.some((a) => a.quote === criticalQuotes[0])).toBe(true);
    expect(c.summaryAuthority).toBe('navigation_only');
  });
  it('fails closed when protected material cannot fit instead of dropping a veto', () => {
    const s = longDiscussion();
    s.discussion.topic = '禁止丢弃此条件。'.repeat(2500);
    expect(() => buildContext(s, [], 12000)).toThrow(ContextBudgetError);
  });
  it('also fails closed when the evidence ledger itself exceeds budget', () => {
    const s = longDiscussion(180);
    s.messages = s.messages.map((m, i) => ({
      ...m,
      text: `必须保留条件${i}，未经批准不得推进第${i}项行动。`,
    }));
    expect(() => buildContext(s, [], 12000)).toThrow(ContextBudgetError);
  });
  it('does not share memory between discussions', () => {
    const a = extractEvidenceMemory(longDiscussion().messages);
    const other = longDiscussion(6);
    other.messages = [];
    expect(extractEvidenceMemory(other.messages).anchors).toEqual([]);
    expect(a.anchors.length).toBeGreaterThan(3);
  });
  it('retains both an earlier veto and a later proposed revision with distinct provenance', () => {
    const s = longDiscussion(600);
    const revision = '建议将每月维护上限改为6人时，需另行批准；未批准前仍执行低于4人时的退出条件。';
    s.messages[400] = { ...s.messages[400], participantId: 'c', text: revision };
    s.discussion.contextSummary = '维护上限已经改为6人时，原分歧已全部关闭。';
    const c = buildContext(s, [], 12000);
    const old = c.evidenceMemory.anchors.find((a) => a.quote === criticalQuotes[2]);
    const proposed = c.evidenceMemory.anchors.find((a) => a.quote === revision);
    expect(old?.messageId).toBe('m3');
    expect(proposed?.messageId).toBe('m401');
    expect(proposed!.seq).toBeGreaterThan(old!.seq);
    expect(c.insights.some((i) => i.id === 'audit-dispute')).toBe(true);
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(10000);
  });
});
describe('evidence-grounded closing and boundary checks', () => {
  it('catches a changed pilot deadline even when an unrelated later-stage clause appears', () => {
    const c = buildContext(longDiscussion(6), [], 12000);
    expect(
      directConsistencyIssues('试点统一持续4周；后续再讨论预算。', c).some(
        (i) => i.kind === 'timeline',
      ),
    ).toBe(true);
  });
  it('does not mistake an independently named evaluation stage for a pilot extension', () => {
    const c = buildContext(longDiscussion(6), [], 12000);
    expect(directConsistencyIssues('2周试点不变，4周收益评估需批准。', c)).toEqual([]);
  });
  it('finds the pilot duration even when the separately approved evaluation is mentioned first', () => {
    const s = longDiscussion(6);
    s.discussion.topic = '后续4周收益评估需批准，初始试点为2周。';
    const c = buildContext(s, [], 12000);
    expect(directConsistencyIssues('试点持续2周。', c)).toEqual([]);
    expect(directConsistencyIssues('试点持续4周。', c).some((i) => i.kind === 'timeline')).toBe(
      true,
    );
  });
  it('does not let a hypothetical in another sentence hide a scope violation', () => {
    const c = buildContext(longDiscussion(6), [], 12000);
    expect(
      directConsistencyIssues('剥离敏感库后继续试点。若误接入则审计。', c).some(
        (i) => i.kind === 'scope',
      ),
    ).toBe(true);
  });
  it('recognizes both unanimous claims and their explicit negation', () => {
    expect(hasUniversalAgreement('全员一致同意扩大范围。')).toBe(true);
    expect(hasUniversalAgreement('并非全员一致同意扩大范围。')).toBe(false);
    expect(hasUniversalAgreement('尚未达成全体共识。')).toBe(false);
  });
  it('keeps compact summary honest about a budget stop while full details retain every condition', () => {
    const s = longDiscussion(180);
    const concise = renderConciseSummary(s, [], 'turn_limit');
    expect(concise.length).toBeLessThan(900);
    expect(concise).toContain('上限');
    expect(concise).not.toContain('已达成一致');
    const details = renderGroundedSummary(s, []);
    for (const q of criticalQuotes) expect(details).toContain(q);
    expect(details).toContain(s.insights[1].text);
  });
  it('does not lose an unresolved disagreement when a model omits it', () => {
    const s = longDiscussion(6);
    expect(reconcileInsights(s.insights, [], [], s.messages)).toEqual([s.insights[1]]);
  });
  it('only resolves a dispute with fresh literal confirmation from all original parties', () => {
    const s = longDiscussion(6);
    const a = {
      ...s.messages.at(-1)!,
      id: 'fresh-b',
      seq: 7,
      participantId: 'b',
      text: '我接受上述修订后的条件。',
    };
    const b = { ...a, id: 'fresh-c', seq: 8, participantId: 'c', text: '我同意上述修订后的条件。' };
    const messages = [...s.messages, a, b];
    const resolution = {
      id: s.insights[1].id,
      evidence: [
        { messageId: a.id, quote: a.text },
        { messageId: b.id, quote: b.text },
      ],
    };
    expect(reconcileInsights(s.insights, [], [resolution], messages)).toEqual([]);
    expect(
      reconcileInsights(
        s.insights,
        [],
        [{ ...resolution, evidence: [resolution.evidence[0], resolution.evidence[0]] }],
        messages,
      ),
    ).toHaveLength(1);
    expect(
      reconcileInsights(
        s.insights,
        [],
        [
          {
            ...resolution,
            evidence: [
              resolution.evidence[0],
              { messageId: 'fresh-c', quote: '我不同意上述修订后的条件。' },
            ],
          },
        ],
        [...s.messages, a, { ...b, text: '我不同意上述修订后的条件。' }],
      ),
    ).toHaveLength(1);
  });
  it('attributes partial support instead of promoting it to unanimous agreement, retains the actual disagreement', () => {
    const s = longDiscussion(6);
    const text = renderGroundedSummary(s, ['m3']);
    expect(text).not.toContain('各方都同意');
    expect(text).not.toContain('全体一致');
    expect(text).toContain('a、d');
    expect(text).toContain(s.insights[1].text);
    for (const q of criticalQuotes) expect(text).toContain(q);
  });
  it('blocks removing nonexistent sensitive data under an established non-sensitive-only scope', () => {
    const c = buildContext(longDiscussion(6), [], 12000);
    expect(
      directConsistencyIssues('剥离敏感库后继续试点。', c).some((i) => i.kind === 'scope'),
    ).toBe(true);
    expect(
      directConsistencyIssues('若误接入敏感库，应先停止并移除误接入数据。', c).filter(
        (i) => i.kind === 'scope',
      ),
    ).toEqual([]);
  });
  it('requires an explicit later phase or extension instead of silently changing a two-week pilot to four weeks', () => {
    const c = buildContext(longDiscussion(6), [], 12000);
    expect(
      directConsistencyIssues('试点在4周内完成收益验证。', c).some((i) => i.kind === 'timeline'),
    ).toBe(true);
    expect(
      directConsistencyIssues('2周试点完成后另设4周收益评估，后续阶段需批准。', c).filter(
        (i) => i.kind === 'timeline',
      ),
    ).toEqual([]);
  });
});
