import type { Intent, Message, Snapshot } from '../shared/types.js';
import { phaseLabels } from '../shared/types.js';
import { extractEvidenceMemory } from './memory.js';
import { ModelError } from './model.js';
import { cycleTurns, limitsFor } from './boundaries.js';
export class ContextBudgetError extends ModelError {
  constructor(budget?: number) {
    super(
      'CONTEXT_BUDGET',
      `关键条件、分歧与当前发言已超出${budget ? `${budget}字符的` : ''}上下文预算，已暂停；请提高预算，不能静默丢弃关键证据。`,
    );
  }
}
export type ContextMessage = Message & { excerpted?: boolean; originalLength?: number };
export function buildContext(snapshot: Snapshot, queue: Intent[], budget: number) {
  const { discussion: d, participants, insights } = snapshot;
  const messages = snapshot.messages.filter((m) => m.seq >= (d.boundaryStartSeq ?? 0));
  // Always derive from original records; a stale or lossy model summary is not authoritative memory.
  const evidenceMemory = extractEvidenceMemory(messages);
  const context = {
    discussionId: d.id,
    topic: d.effectiveTopic ?? d.topic,
    activeFocus: d.focus ?? '',
    directionVersion: d.directionVersion ?? 0,
    directions: messages
      .filter((m) => m.kind === 'direction')
      .map((m) => ({ id: m.id, text: m.text, mode: m.directionMode, version: m.directionVersion })),
    phase: phaseLabels[d.phase],
    turns: cycleTurns(d),
    maxTurns: d.maxTurns,
    participants,
    participation: participants
      .filter((p) => p.role === 'expert')
      .map((p) => ({
        participantId: p.id,
        turns: messages.filter((m) => m.participantId === p.id && m.seq >= (d.cycleStartSeq ?? 0))
          .length,
      })),
    termination: { ...limitsFor(d), maxTurns: d.maxTurns },
    messages: [] as ContextMessage[],
    insights,
    evidenceMemory,
    contextSummary: d.contextSummary,
    summaryAuthority: 'navigation_only' as const,
    omittedMessageCount: 0,
    compression: {
      applied: false,
      inputChars: 0,
      originalMessageChars: JSON.stringify(messages).length,
      archivedMessageCount: snapshot.messages.length - messages.length,
      excerptedMessageIds: [] as string[],
    },
  };
  const cap = budget - 2000; // Reserve for current role, intent, candidate and control fields.
  const size = () => JSON.stringify(context).length;
  const recent = new Set(messages.slice(-2).map((m) => m.id));
  const refs = new Set([
    ...insights.flatMap((i) => i.messageIds),
    ...queue.flatMap((i) => (i.replyTo ? [i.replyTo] : [])),
    ...messages.filter((m) => m.kind === 'direction').map((m) => m.id),
  ]);
  const add = (message: Message, excerpt = false) => {
    if (context.messages.some((m) => m.id === message.id)) return;
    let value: ContextMessage = { ...message };
    if (excerpt && !recent.has(message.id)) {
      const quotes = evidenceMemory.anchors
        .filter((a) => a.messageId === message.id)
        .map((a) => a.quote);
      const excerptText = quotes.length ? quotes.join('\n') : message.text;
      value = {
        ...message,
        text: excerptText,
        excerpted: excerptText !== message.text,
        originalLength: message.text.length,
      };
    }
    context.messages.push(value);
  };
  for (const m of messages) if (recent.has(m.id) || refs.has(m.id)) add(m, true);
  // A summary is only navigation; original critical evidence and unresolved positions stay protected.
  if (size() > cap) context.contextSummary = '滚动摘要已省略；以原文证据记忆与当前分歧为准。';
  if (size() > cap) throw new ContextBudgetError(budget);
  for (const message of [...messages].reverse()) {
    if (context.messages.some((m) => m.id === message.id)) continue;
    add(message);
    if (size() > cap) context.messages = context.messages.filter((m) => m.id !== message.id);
  }
  context.messages.sort((a, b) => a.seq - b.seq);
  const statistics = () => {
    context.omittedMessageCount = messages.length - context.messages.length;
    context.compression.applied =
      context.omittedMessageCount > 0 || context.messages.some((m) => m.excerpted);
    context.compression.excerptedMessageIds = context.messages
      .filter((m) => m.excerpted)
      .map((m) => m.id);
    for (let i = 0; i < 3; i++) context.compression.inputChars = size();
  };
  statistics();
  while (size() > cap) {
    const optional = context.messages.findIndex((m) => !refs.has(m.id) && !recent.has(m.id));
    if (optional < 0) break;
    context.messages.splice(optional, 1);
    statistics();
  }
  if (size() > cap) throw new ContextBudgetError(budget);
  return context;
}
export type DiscussionContext = ReturnType<typeof buildContext>;
export function contextInput<T extends Record<string, unknown>>(
  context: DiscussionContext,
  extra: T,
  budget: number,
) {
  const input = { ...context, ...extra };
  if (JSON.stringify(input).length > budget) throw new ContextBudgetError(budget);
  return input;
}
