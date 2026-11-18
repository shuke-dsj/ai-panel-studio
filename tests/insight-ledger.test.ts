import { describe, it, expect } from 'vitest';
import { applyLedger, projectInsights } from '../server/insight-ledger.js';
import { isClosedDisagreement } from '../shared/types.js';
import type { InsightLedger, Message, Participant } from '../shared/types.js';
import type { LedgerDecision } from '../server/schemas.js';
const people = ['a', 'b', 'c', 'host'].map((id) => ({
  id,
  discussionId: 'd',
  role: id === 'host' ? 'moderator' : 'expert',
  name: id,
  occupation: '专家',
  title: '评审',
  stance: '',
  focus: '',
  color: '#123456',
})) as Participant[];
const m = (id: string, person: string, seq: number, text: string): Message => ({
  id,
  participantId: person,
  seq,
  text,
  discussionId: 'd',
  replyTo: null,
  addressedTo: null,
  phase: 'exchange',
  createdAt: '2026-11-18',
});
const messages = [
  m('a1', 'a', 1, '启动前必须指定退出负责人。'),
  m('b1', 'b', 2, '我不同意启动前指定退出负责人，应当在退出前完成。'),
  m('a2', 'a', 3, '我撤回启动前指定退出负责人的要求，退出前完成即可。'),
  m('b2', 'b', 4, '退出前指定退出负责人即可，启动不以此为门槛。'),
  m('a3', 'a', 5, '我不同意每周强制复盘，这是另一个问题。'),
  m('c1', 'c', 6, '我只是记录这项讨论，不代表支持此结论。'),
  m('b3', 'b', 7, '有新证据后我反对退出前才指定负责人。'),
];
const e = (
  id: string,
  stance: LedgerDecision['evidence'][number]['stance'],
  supportsClaim = stance === 'support' || stance === 'accept',
) => ({
  messageId: id,
  quote: messages.find((m) => m.id === id)!.text,
  stance,
  supportsClaim,
  view: '原文立场',
});
const decision = (patch: Partial<LedgerDecision> = {}): LedgerDecision => ({
  issueId: null,
  mergeIds: [],
  question: '退出负责人何时指定',
  text: '退出负责人须在启动前还是退出前指定',
  status: 'disagreement',
  complete: true,
  evidence: [e('a1', 'support'), e('b1', 'oppose')],
  ...patch,
});
const empty = (): InsightLedger => ({ version: 1, records: [], audit: [] });
const run = (l: InsightLedger, d: LedgerDecision[], ms = messages.slice(0, 6)) =>
  applyLedger(l, d, ms, people, 'd:0');
const opened = () => run(empty(), [decision()]).ledger;
const close = (id: string, patch: Partial<LedgerDecision> = {}) =>
  decision({
    issueId: id,
    status: 'consensus',
    text: '退出负责人在退出前指定，不作为启动门槛',
    evidence: [e('a2', 'accept'), e('b2', 'support')],
    ...patch,
  });
describe('canonical evidence ledger', () => {
  it('records question to consensus without a dispute closure, including legacy display filtering', () => {
    const pending = run(empty(), [
      decision({ status: 'question', evidence: [e('a2', 'support')] }),
    ]).ledger;
    const result = run(pending, [close(pending.records[0].id)]);
    const record = result.ledger.records[0];
    expect(result.insights[0].kind).toBe('consensus');
    expect(result.audit.closed).toEqual([]);
    expect(record.closedAtSeq).toBeUndefined();
    expect(isClosedDisagreement({ ...record, closedAtSeq: 6 })).toBe(false);
  });
  it('migrates an unverified legacy pending item with two literal context witnesses without hiding a verified opposition', () => {
    const l = opened();
    l.records[0].verified = false;
    const update = decision({
      issueId: l.records[0].id,
      status: 'question',
      text: '待用户指定',
      evidence: [e('a2', 'context'), e('b2', 'context')],
    });
    expect(run(l, [update]).ledger.records[0].status).toBe('question');
    l.records[0].verified = true;
    expect(run(l, [update]).insights[0].kind).toBe('disagreement');
  });
  it('does not treat unverified legacy context as a later opposing position on the issue', () => {
    const l = opened(),
      r = l.records[0];
    r.verified = false;
    r.history.push({
      status: 'disagreement',
      text: '旧模型的混合引用',
      seq: 5,
      evidence: [
        {
          ...e('a3', 'context'),
          participantId: 'a',
          seq: 5,
        },
      ],
    });
    const result = run(l, [close(r.id)]);
    expect(result.audit.closed).toEqual([r.id]);
  });
  it('reuses an ID for revised wording and retains omitted verified common ground', () => {
    const l = opened(),
      id = l.records[0].id;
    const next = run(l, [close(id)]);
    expect(next.ledger.records).toHaveLength(1);
    expect(next.insights[0].id).toBe(id);
    expect(next.audit.closed).toEqual([id]);
    expect(run(next.ledger, []).insights).toEqual(next.insights);
    expect(next.ledger.records[0].history).toHaveLength(2);
  });
  it('matches a repeated normalized question without an ID instead of creating duplicates', () => {
    const next = run(opened(), [
      decision({ question: '退出负责人，何时指定？', text: '措辞调整的争议' }),
    ]);
    expect(next.ledger.records).toHaveLength(1);
  });
  it('merges historical synonyms while preserving aliases, history and a tombstone', () => {
    const l = run(empty(), [
      decision(),
      decision({ question: '是否需要启动前确定退出责任人', text: '退出责任人的指定时点尚有争议' }),
    ]).ledger;
    const [a, b] = l.records;
    const next = run(l, [close(a.id, { mergeIds: [b.id] })]);
    expect(next.insights).toHaveLength(1);
    expect(next.ledger.records.find((r) => r.id === b.id)?.mergedInto).toBe(a.id);
    expect(next.ledger.records.find((r) => r.id === a.id)?.aliases).toContain(b.id);
    expect(next.audit.merged).toEqual([b.id]);
  });
  it('closes on actual clarification without requiring a keyword and ignores later unrelated opposition', () => {
    const l = opened();
    const result = run(l, [close(l.records[0].id)]);
    expect(result.audit.rejected).toEqual([]);
    expect(result.ledger.records[0].closedAtSeq).toBe(6);
  });
  it.each(['partial', 'one-party', 'host', 'fake', 'stale'] as const)(
    'rejects %s closure proof',
    (kind) => {
      const l = opened();
      const d = close(l.records[0].id);
      if (kind === 'partial') d.complete = false;
      if (kind === 'one-party') d.evidence = [e('a2', 'accept')];
      if (kind === 'host')
        d.evidence = [e('a2', 'accept'), { ...e('b2', 'support'), messageId: 'h' }];
      if (kind === 'fake') d.evidence[1].quote = '双方无条件同意所有安排';
      if (kind === 'stale') d.evidence = [e('a2', 'accept'), e('b1', 'support')];
      const next = run(
        l,
        [d],
        [
          ...messages.slice(0, 6),
          m('h', 'host', 8, '退出前指定退出负责人即可，启动不以此为门槛。'),
        ],
      );
      expect(next.audit.rejected).toHaveLength(1);
      expect(next.insights[0].kind).toBe('disagreement');
    },
  );
  it('does not resurrect a merged closed issue from historical opposition, but permits new opposition', () => {
    const l = opened(),
      id = l.records[0].id;
    const closed = run(l, [close(id)]).ledger;
    expect(run(closed, [decision()]).audit.rejected[0].reason).toMatch(/requires_new_opposition/);
    const reopened = run(
      closed,
      [decision({ issueId: id, evidence: [e('a2', 'support'), e('b3', 'oppose')] })],
      messages,
    );
    expect(reopened.audit.reopened).toEqual([id]);
    expect(reopened.ledger.records[0].closedAtSeq).toBeUndefined();
  });
  it('publishes only literal positive witnesses as consensus supporters, excluding context observers', () => {
    const result = run(empty(), [
      close(null as unknown as string, {
        evidence: [e('a2', 'support'), e('b2', 'accept'), e('c1', 'context')],
      }),
    ]);
    expect(result.insights[0].positions.map((p) => p.participantId)).toEqual(['a', 'b']);
    expect(result.ledger.records[0].requiredParticipantIds).toEqual(['a', 'b']);
    expect(
      result.insights[0].evidence?.every((e) =>
        messages.find((m) => m.id === e.messageId)?.text.includes(e.quote),
      ),
    ).toBe(true);
  });
  it('keeps an externally pending question separate from actual disagreement', () => {
    const result = run(empty(), [
      decision({
        status: 'question',
        text: '负责人由用户后续指定',
        evidence: [e('a2', 'context'), e('b2', 'context')],
      }),
    ]);
    expect(result.ledger.records[0].status).toBe('question');
    expect(projectInsights(result.ledger)).toEqual([]);
    expect(
      run(empty(), [decision({ evidence: [e('a2', 'support'), e('b2', 'support')] })]).audit
        .rejected[0].reason,
    ).toBe('use_question_for_unconfirmed_proposal');
  });
  it('cannot downgrade an actual dispute into a pending question with incomplete party coverage', () => {
    const l = opened();
    const next = run(l, [
      decision({ issueId: l.records[0].id, status: 'question', evidence: [e('a2', 'accept')] }),
    ]);
    expect(next.insights[0].kind).toBe('disagreement');
  });
  it('does not accept another boundary source or two quotes by a single speaker as consensus', () => {
    expect(
      run(
        empty(),
        [close(null as unknown as string)],
        messages.filter((m) => m.id !== 'b2'),
      ).audit.rejected[0].reason,
    ).toBe('invalid_literal_evidence');
    expect(
      run(empty(), [
        close(null as unknown as string, { evidence: [e('a1', 'support'), e('a2', 'support')] }),
      ]).insights,
    ).toEqual([]);
  });
});
