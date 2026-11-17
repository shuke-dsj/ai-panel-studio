import type { Message, Participant, Snapshot } from '../../shared/types.js';
export const criticalQuotes = [
  '试点仅持续2周，只允许非敏感文档，禁止接入敏感库。',
  '我反对在审计通过前扩展范围，权限失败必须暂停。',
  '每月维护必须低于4人时，否则退出。',
  '2周试点之后另设4周收益评估，两阶段不能混为同一截止日。',
];
export function longDiscussion(count = 180): Snapshot {
  const id = 'stress-isolated';
  const participants: Participant[] = ['host', 'a', 'b', 'c', 'd'].map((p, i) => ({
    id: p,
    discussionId: id,
    role: i ? 'expert' : 'moderator',
    name: p,
    occupation: '评审',
    title: '专家',
    stance: '不同立场',
    focus: '验证',
    color: '#15745b',
  }));
  const msg = (n: number, text: string, who = 'a'): Message => ({
    id: `m${n}`,
    discussionId: id,
    participantId: who,
    seq: n,
    text,
    replyTo: null,
    addressedTo: null,
    phase: 'exchange',
    createdAt: '2026-11-17T00:00:00Z',
  });
  const messages = [
    msg(1, criticalQuotes[0]),
    msg(2, criticalQuotes[1], 'b'),
    msg(3, criticalQuotes[2], 'c'),
    msg(4, criticalQuotes[3], 'd'),
  ];
  for (let n = 5; n <= count; n++)
    messages.push(
      msg(
        n,
        `背景记录${n}：` + '白云经过山谷，沿途风景各不相同，大家在描述自己的观察。'.repeat(45),
        n % 2 ? 'a' : 'b',
      ),
    );
  messages[messages.length - 1] = {
    ...msg(count, '请回应早期未决分歧，不能把否决条件写成全体赞同。', 'd'),
    replyTo: 'm2',
  };
  return {
    discussion: {
      id,
      topic: '6位工程师、无专职运维；只做非敏感库的2周试点，后续4周评估需另行批准。',
      expertCount: 4,
      maxTurns: 20,
      turns: count,
      status: 'running',
      phase: 'exchange',
      summary: null,
      contextSummary: '这是故意遗漏早期红线的有损摘要，不能覆盖原文证据。',
      error: null,
      resumeStatus: null,
      createdAt: '',
      updatedAt: '',
      source: 'test',
    },
    participants,
    messages,
    insights: [
      {
        id: 'scope-agreement',
        kind: 'consensus',
        text: '先限定非敏感文档试点',
        messageIds: ['m1', 'm4'],
        positions: [
          { participantId: 'a', view: '非敏感范围' },
          { participantId: 'd', view: '分阶段' },
        ],
      },
      {
        id: 'audit-dispute',
        kind: 'disagreement',
        text: '审计失败后能否继续其他验证仍未解决',
        messageIds: ['m2', 'm3'],
        positions: [
          { participantId: 'b', view: '权限失败暂停' },
          { participantId: 'c', view: '成本判断独立' },
        ],
      },
    ],
    activities: {},
    cursor: 1,
  };
}
