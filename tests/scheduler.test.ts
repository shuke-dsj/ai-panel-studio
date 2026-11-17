import { describe, it, expect } from 'vitest';
import { selectSpeakers, validateInsights, phaseFor } from '../server/scheduler.js';
import type { Intent, Message, Participant } from '../shared/types.js';
const person = (id: string): Participant => ({
  id,
  discussionId: 'd',
  role: 'expert',
  name: id,
  occupation: '测试',
  title: '专家',
  stance: '谨慎',
  focus: '测试',
  color: '#123456',
});
const message = (id: string, participantId: string, text = '需要先完成可量化评估'): Message => ({
  id,
  discussionId: 'd',
  participantId,
  seq: 1,
  text,
  replyTo: null,
  addressedTo: null,
  phase: 'exchange',
  createdAt: '',
});
const intent = (participantId: string, patch: Partial<Intent> = {}): Intent => ({
  participantId,
  apply: true,
  kind: 'raise',
  replyTo: null,
  urgency: 1,
  publicReason: '关注评估',
  ...patch,
});
describe('autonomous scheduler', () => {
  it('prioritizes a direct question instead of roster order', () => {
    const m = { ...message('m', 'host'), addressedTo: 'c' };
    expect(
      selectSpeakers(
        ['a', 'b', 'c'].map((i) => intent(i)),
        [m],
        [],
        ['a', 'b', 'c'].map(person),
      )[0].participantId,
    ).toBe('c');
  });
  it('avoids consecutive speakers when alternatives exist, selects at most two', () => {
    const result = selectSpeakers(
      [intent('a', { urgency: 3 }), intent('b'), intent('c')],
      [message('m', 'a')],
      [],
      ['a', 'b', 'c'].map(person),
    );
    expect(result).toHaveLength(2);
    expect(result[0].participantId).not.toBe('a');
    expect(result[1].participantId).not.toBe(result[0].participantId);
  });
  it('prioritizes actual dispute responses and filters abstentions/foreign actors', () => {
    const result = selectSpeakers(
      [
        intent('a'),
        intent('b', { replyTo: 'dispute', kind: 'rebuttal' }),
        intent('foreign'),
        intent('c', { apply: false }),
      ],
      [message('dispute', 'a')],
      [{ id: 'i', kind: 'disagreement', text: '争议', messageIds: ['dispute'], positions: [] }],
      ['a', 'b', 'c'].map(person),
    );
    expect(result.map((i) => i.participantId)).toEqual(['b', 'a']);
  });
  it('uses stable tie breaks, handles no applicants and phase boundaries', () => {
    expect(
      selectSpeakers([intent('b'), intent('a')], [], [], ['a', 'b'].map(person)).map(
        (i) => i.participantId,
      ),
    ).toEqual(['a', 'b']);
    expect(selectSpeakers([], [], [], [])).toEqual([]);
    expect([0, 4, 8].map((n) => phaseFor(n, 12))).toEqual([
      'exploration',
      'exchange',
      'convergence',
    ]);
  });
});
describe('grounded insights', () => {
  const messages = [
    message('m1', 'a'),
    message('m2', 'b'),
    message('m3', 'c', '反对立刻部署，需要先完成可量化评估'),
  ];
  const ev = (id: string, stance: 'support' | 'oppose' = 'support') => ({
    messageId: id,
    quote: '需要先完成可量化评估',
    stance,
    view: '先评估',
  });
  const check = (evidence: ReturnType<typeof ev>[]) =>
    validateInsights(
      { items: [{ kind: 'consensus', text: '先评估', evidence }], contextSummary: '评估' },
      messages,
      ['a', 'b', 'c'].map(person),
    );
  it('requires two distinct experts with literal evidence', () => {
    expect(check([ev('m1')])).toEqual([]);
    expect(check([ev('m1'), ev('m1')])).toEqual([]);
    expect(check([ev('m1'), ev('m2')])[0].kind).toBe('consensus');
  });
  it('retains opposition as disagreement and rejects fabricated evidence', () => {
    expect(check([ev('m1'), ev('m2'), ev('m3', 'oppose')])[0].kind).toBe('disagreement');
    expect(check([ev('foreign'), { ...ev('m1'), quote: '不存在的引用' }])).toEqual([]);
  });
});
