import type { Insight, Intent, Message, Participant, Phase } from '../shared/types.js';
import type { InsightOutput } from './schemas.js';
import { hasUniversalAgreement } from './consistency.js';
import { createHash } from 'node:crypto';
export function phaseFor(turns: number, max: number): Phase {
  return turns < Math.ceil(max / 3)
    ? 'exploration'
    : turns < Math.ceil((max * 2) / 3)
      ? 'exchange'
      : 'convergence';
}
export function selectSpeakers(
  intents: Intent[],
  messages: Message[],
  insights: Insight[],
  experts: Participant[],
  limit = 2,
): Intent[] {
  const valid = new Set(experts.map((p) => p.id));
  const expertMessages = messages.filter((m) => valid.has(m.participantId));
  const last = expertMessages.at(-1)?.participantId;
  const addressed = messages.at(-1)?.addressedTo;
  const disputeIds = new Set(
    insights.filter((i) => i.kind === 'disagreement').flatMap((i) => i.messageIds),
  );
  const count = (id: string) =>
    expertMessages.slice(-8).filter((m) => m.participantId === id).length;
  const age = (id: string) => {
    const index = expertMessages.findLastIndex((m) => m.participantId === id);
    return index < 0 ? expertMessages.length + 1 : expertMessages.length - 1 - index;
  };
  const candidates = [
    ...new Map(
      intents.filter((i) => i.apply && valid.has(i.participantId)).map((i) => [i.participantId, i]),
    ).values(),
  ];
  const rank = (i: Intent) => [
    Number(i.participantId === addressed),
    Number(
      expertMessages.length >= experts.length &&
        !expertMessages.some((m) => m.participantId === i.participantId),
    ),
    Number(!!i.replyTo && disputeIds.has(i.replyTo)),
    Number(i.kind === 'rebuttal' || i.kind === 'supplement'),
    age(i.participantId),
    -count(i.participantId),
    i.urgency,
  ];
  candidates.sort((a, b) => {
    const ar = rank(a),
      br = rank(b);
    for (let i = 0; i < ar.length; i++) {
      if (ar[i] !== br[i]) return br[i] - ar[i];
    }
    return a.participantId.localeCompare(b.participantId);
  });
  const result: Intent[] = [];
  let previous = last;
  while (candidates.length && result.length < Math.min(2, limit)) {
    let index = candidates.findIndex((i) => i.participantId !== previous);
    if (index < 0) index = 0;
    const [next] = candidates.splice(index, 1);
    result.push(next);
    previous = next.participantId;
  }
  return result;
}
export function validateInsights(
  output: InsightOutput,
  messages: Message[],
  participants: Participant[],
  previous: Insight[] = [],
): Insight[] {
  const experts = new Set(participants.filter((p) => p.role === 'expert').map((p) => p.id));
  return output.items.flatMap((item, index) => {
    if (hasUniversalAgreement(item.text)) return [];
    // Closing an issue requires the resolution evidence protocol, not a label
    // embedded in a newly generated open-disagreement item.
    if (item.kind === 'disagreement' && /^(?:已关闭|已解决|已消除)[:：\s]/.test(item.text))
      return [];
    const evidence = item.evidence.flatMap((e) => {
      const m = messages.find((m) => m.id === e.messageId);
      return m && experts.has(m.participantId) && e.quote.length >= 4 && m.text.includes(e.quote)
        ? [{ ...e, participantId: m.participantId }]
        : [];
    });
    const support = new Set(
      evidence.filter((e) => e.stance === 'support').map((e) => e.participantId),
    );
    const opposition = evidence.some((e) => e.stance === 'oppose');
    if (item.kind === 'consensus' && (support.size < 2 || opposition)) {
      if (!opposition || new Set(evidence.map((e) => e.participantId)).size < 2) return [];
    }
    if (!evidence.length) return [];
    const kind =
      item.kind === 'consensus' && support.size >= 2 && !opposition ? 'consensus' : 'disagreement';
    return [
      {
        id:
          item.id && previous.some((i) => i.id === item.id && i.kind === kind)
            ? item.id
            : `${kind}-${createHash('sha256').update(item.text).digest('hex').slice(0, 12)}`,
        kind,
        text: item.text,
        messageIds: [...new Set(evidence.map((e) => e.messageId))],
        positions: evidence.map((e) => ({ participantId: e.participantId, view: e.view })),
      } satisfies Insight,
    ];
  });
}
export function reconcileInsights(
  previous: Insight[],
  next: Insight[],
  resolutions: { id: string; evidence: { messageId: string; quote: string }[] }[],
  messages: Message[],
  participants?: Participant[],
): Insight[] {
  const result = new Map(next.map((i) => [i.id, i]));
  for (const old of previous.filter((i) => i.kind === 'disagreement')) {
    if (result.has(old.id)) continue;
    const resolution = resolutions.find((r) => r.id === old.id);
    const required = new Set(old.positions.map((p) => p.participantId));
    const lastFor = (person: string) =>
      Math.max(
        0,
        ...old.messageIds.map(
          (id) => messages.find((m) => m.id === id && m.participantId === person)?.seq ?? 0,
        ),
      );
    const expertIds = participants
      ? new Set(participants.filter((p) => p.role === 'expert').map((p) => p.id))
      : null;
    const confirmations = new Set(
      resolution?.evidence.flatMap((e) => {
        const m = messages.find((m) => m.id === e.messageId);
        return m &&
          (!expertIds || expertIds.has(m.participantId)) &&
          m.seq >= lastFor(m.participantId) &&
          e.quote.length >= 4 &&
          m.text.includes(e.quote) &&
          /同意|接受|撤回|不再反对|赞同|支持|认可|确认|降为|仅作|只写入|\bagree\b|\bwithdraw\b/i.test(
            e.quote,
          ) &&
          !/不同意|不接受|不能接受|仍反对|不撤回|尚未同意|不支持|不认可|未确认|\bdisagree\b/i.test(
            e.quote,
          ) &&
          !messages.some(
            (later) =>
              later.participantId === m.participantId &&
              later.seq > m.seq &&
              /仍(?:然)?反对|不同意|不接受|不再支持/.test(later.text),
          )
          ? [m.participantId]
          : [];
      }) ?? [],
    );
    if (
      !resolution ||
      confirmations.size < 2 ||
      ![...required].every((id) => confirmations.has(id))
    )
      result.set(old.id, old);
  }
  return [...result.values()];
}
