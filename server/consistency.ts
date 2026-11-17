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
  if (
    nonSensitive &&
    /(?:剥离|移除|删除|清理)敏感(?:库|文档|数据)/.test(text) &&
    !/(?:若|如果|假设).{0,12}(?:误接入|误收录|误纳入)/.test(text)
  )
    issues.push({
      kind: 'scope',
      quote: text,
      reason:
        '已限定非敏感范围，不能暗示敏感库原本在范围内；若是误接入或变更建议，必须明确标示并保持原边界。',
      conflictsWith: [nonSensitive.id],
    });
  const pilot = established.find((s) => /试点/.test(s.text) && durations(s.text).length);
  if (pilot) {
    const original = durations(pilot.text)[0].days;
    const other = durations(text).filter((d) => d.days !== original);
    if (
      /试点/.test(text) &&
      other.length &&
      !/后续|之后|另设|另行|延长|建议改为|提议改为/.test(text)
    )
      issues.push({
        kind: 'timeline',
        quote: text,
        reason:
          '新时长与既有试点安排不同，必须说明是后续独立阶段或待批准的延长，不能静默改写试点截止日。',
        conflictsWith: [pilot.id],
      });
  }
  return issues;
}
export function hasUniversalAgreement(text: string) {
  return /(?:各方|大家|全体|所有专家)(?:都|均|已经|已)?(?:同意|一致|达成共识)/.test(
    text.replace(
      /(?:并非|没有|尚未|未能|不代表)(?:各方|大家|全体|所有专家)(?:都|均)?(?:同意|一致|达成共识)/g,
      '',
    ),
  );
}
