import type { DiscussionContext } from './context.js';
export interface ConsistencyIssue {
  kind: 'scope' | 'timeline' | 'consensus';
  quote: string;
  reason: string;
  conflictsWith: string[];
}
const number = (text: string) =>
  ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 })[text] ??
  Number(text);
function durations(text: string) {
  return [...text.matchAll(/(\d+|[一二两三四五六七八九十]+)\s*(天|周|个月|月)/g)].map((m) => ({
    raw: m[0],
    days: number(m[1]) * (m[2] === '天' ? 1 : m[2] === '周' ? 7 : 30),
  }));
}
function pilotDuration(text: string) {
  const duration = '(?:\\d+|[一二两三四五六七八九十]+)\\s*(?:天|周|个月|月)';
  const match = text.match(
    new RegExp(`(?:${duration}[^，,；;。！？]{0,6}试点|试点[^，,；;。！？]{0,12}${duration})`),
  );
  return match ? durations(match[0])[0]?.days : undefined;
}
export function directConsistencyIssues(
  text: string,
  context: DiscussionContext,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const established = [
    { text: context.topic, id: 'topic' },
    ...context.insights
      .filter((i) => i.kind === 'consensus')
      .map((i) => ({ text: i.text, id: i.messageIds[0] })),
  ];
  const nonSensitive = established.find(
    (s) => /(?:仅|只|限定|限于)[^。！？]{0,35}非敏感/.test(s.text) && !/不只|不仅/.test(s.text),
  );
  const scopeConflict = text
    .split(/[。！？；;\n]/)
    .find(
      (sentence) =>
        /(?:剥离|移除|删除|清理)敏感(?:库|文档|数据)/.test(sentence) &&
        !/(?:若|如果|假设).{0,12}(?:误接入|误收录|误纳入)/.test(sentence),
    );
  if (nonSensitive && scopeConflict)
    issues.push({
      kind: 'scope',
      quote: scopeConflict,
      reason:
        '已限定非敏感范围，不能暗示敏感库原本在范围内；若是误接入或变更建议，必须明确标示并保持原边界。',
      conflictsWith: [nonSensitive.id],
    });
  const pilot = established.find((s) => pilotDuration(s.text) !== undefined);
  if (pilot) {
    const original = pilotDuration(pilot.text)!;
    // Scope the exception to the actual pilot clause: an unrelated “后续”
    // elsewhere must not silently authorize changing the current deadline.
    const conflictingClause = text
      .split(/[，,；;。！？\n]/)
      .find(
        (clause) =>
          /试点/.test(clause) &&
          durations(clause).some((d) => d.days !== original) &&
          !/后续|之后|另设|另行|(?:建议|提议|待批准).{0,12}(?:延长|改为)|延长.{0,12}(?:建议|提议|待批准)/.test(
            clause,
          ),
      );
    if (conflictingClause)
      issues.push({
        kind: 'timeline',
        quote: conflictingClause,
        reason:
          '新时长与既有试点安排不同，必须说明是后续独立阶段或待批准的延长，不能静默改写试点截止日。',
        conflictsWith: [pilot.id],
      });
  }
  return issues;
}
export function hasUniversalAgreement(text: string) {
  return /(?:各方|大家|全体|全员|所有专家)(?:都|均|已经|已)?(?:一致(?:同意|赞同)?|同意|赞同|达成共识)/.test(
    text.replace(
      /(?:并非|没有|尚未|未能|不代表)(?:各方|大家|全体|全员|所有专家)(?:都|均)?(?:一致(?:同意|赞同)?|同意|赞同|达成共识)/g,
      '',
    ),
  );
}
