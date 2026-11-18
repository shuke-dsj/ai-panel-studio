import { prompts, sharedSystemPrompt, type Task } from './prompts.js';

export type RequestLayout = 'prefix' | 'legacy';
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
  return [
    { role: 'system', content: sharedSystemPrompt },
    { role: 'user', content: JSON.stringify(record ? shared : { input: canonical(normalized) }) },
    // Task rules retain system authority; untrusted transcripts are never
    // promoted into system instructions or fabricated assistant turns.
    { role: 'system', content: prompts[task] + retryHint },
    { role: 'user', content: JSON.stringify(canonical(dynamic)) },
  ];
}
