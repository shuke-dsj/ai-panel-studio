import { prompts, sharedSystemPrompt, type Task } from './prompts.js';

export type RequestLayout = 'compact' | 'prefix' | 'legacy';
export interface ModelMessage {
  role: 'system' | 'user';
  content: string;
}
// Normalize object key order only. Array order and every JSON value are preserved.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function buildModelMessages(
  task: Task,
  input: unknown,
  retryHint = '',
  layout: RequestLayout = 'prefix',
): ModelMessage[] {
  if (layout === 'legacy')
    return [
      { role: 'system', content: prompts[task] + retryHint },
      { role: 'user', content: JSON.stringify(input) ?? 'null' },
    ];
  const normalized = JSON.parse(JSON.stringify(input) ?? 'null') as unknown;
  const record =
    normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? (normalized as Record<string, unknown>)
      : null;
  const shared: Record<string, unknown> = Object.create(null),
    dynamic: Record<string, unknown> = Object.create(null);
  // History precedes derived snapshot material. A new speech invalidates the
  // later snapshot, never the preceding transcript. Same-revision calls can
  // also share evidence and outcomes across tasks. Scope changes break early.
  const stableKeys = [
    'discussionId',
    'topic',
    'participants',
    'maxTurns',
    'termination',
    'summaryAuthority',
    'messages',
    'evidenceMemory',
    'insights',
    'knownIssues',
    'directions',
    'contextSummary',
  ];
  if (record) {
    for (const key of stableKeys)
      if (Object.hasOwn(record, key)) shared[key] = canonical(record[key]);
    for (const [key, value] of Object.entries(record))
      if (!stableKeys.includes(key)) dynamic[key] = value;
  }
  if (layout === 'compact' && record && Array.isArray(shared.messages)) {
    const current = dynamic.current as { id?: string } | undefined;
    if (
      current?.id &&
      Array.isArray(shared.participants) &&
      shared.participants.some((p) => JSON.stringify(p) === JSON.stringify(canonical(current)))
    ) {
      dynamic.current = { id: current.id };
    }
    if (record.compression && record.summaryAuthority === 'navigation_only')
      delete dynamic.compression;
    const transcript = shared.messages.map((entry: Record<string, unknown>) => {
      const { discussionId, createdAt, ...message } = entry;
      return message;
    });
    delete shared.messages;
    const snapshot: Record<string, unknown> = {};
    for (const key of [
      'evidenceMemory',
      'insights',
      'knownIssues',
      'directions',
      'contextSummary',
    ]) {
      if (Object.hasOwn(shared, key)) {
        snapshot[key] = shared[key];
        delete shared[key];
      }
    }
    return [
      {
        role: 'system',
        content:
          sharedSystemPrompt +
          '\n共享材料的第一行是基本资料JSON，随后每行依次是 messages 的一个原始记录对象，最后一行以 SNAPSHOT 开头，余下部分为当前证据与账本JSON。按既有字段名合并理解。current只有id时，请按id读取participants中的完整对应角色资料和立场。每条发言的 id、seq、作者、正文、回复关系和所有范围约束保持有效。',
      },
      {
        role: 'user',
        content:
          JSON.stringify(shared) +
          '\n' +
          transcript.map((m) => JSON.stringify(m) + '\n').join('') +
          'SNAPSHOT ' +
          JSON.stringify(snapshot),
      },
      { role: 'system', content: prompts[task] + retryHint },
      { role: 'user', content: JSON.stringify(canonical(dynamic)) },
    ];
  }
  return [
    { role: 'system', content: sharedSystemPrompt },
    { role: 'user', content: JSON.stringify(record ? shared : { input: canonical(normalized) }) },
    // Task rules retain system authority; untrusted transcripts are never
    // promoted into system instructions or fabricated assistant turns.
    { role: 'system', content: prompts[task] + retryHint },
    { role: 'user', content: JSON.stringify(canonical(dynamic)) },
  ];
}
