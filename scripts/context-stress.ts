import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildContext } from '../server/context.js';
import { configuredModel } from '../server/config.js';
import { retentionSchema } from '../server/schemas.js';
import { longDiscussion, criticalQuotes } from '../tests/fixtures/long-discussion.js';
const output = 'docs/evidence/context-stress-latest.json';
const cases = [];
for (const count of [40, 180, 600])
  for (const budget of [12000, 28000]) {
    const snapshot = longDiscussion(count);
    const before = JSON.stringify(snapshot);
    const started = performance.now();
    const context = buildContext(snapshot, [], budget);
    const actual = JSON.stringify(context).length;
    const checks = {
      withinBudget: actual <= budget - 2000,
      allCriticalQuotes: criticalQuotes.every((q) =>
        context.evidenceMemory.anchors.some((a) => a.quote === q),
      ),
      unresolvedDispute:
        JSON.stringify(context.insights[1]) === JSON.stringify(snapshot.insights[1]),
      recentMessage: context.messages.some(
        (m) => m.id === snapshot.messages.at(-1)!.id && m.text === snapshot.messages.at(-1)!.text,
      ),
      originalUnchanged: before === JSON.stringify(snapshot),
    };
    cases.push({
      messages: count,
      budget,
      rawMessageChars: context.compression.originalMessageChars,
      inputChars: actual,
      omittedMessages: context.omittedMessageCount,
      protectedAnchors: context.evidenceMemory.anchors.length,
      durationMs: Math.round(performance.now() - started),
      checks,
    });
  }
const report: {
  testedAt: string;
  budgetUnit: string;
  fixtureSource: string;
  cases: typeof cases;
  realProbe?: unknown;
  passed?: boolean;
} = {
  testedAt: new Date().toISOString(),
  budgetUnit: '完整上下文JSON的UTF-16字符数，预留2000字符给角色/候选/控制字段；不是精确Token预算。',
  fixtureSource: '明确标记的合成长历史，不写入live讨论数据库。',
  cases,
};
mkdirSync('docs/evidence', { recursive: true });
try {
  if (process.argv.includes('--real')) {
    const model = configuredModel(true);
    if (!model.configured)
      throw new Error('真实模型未配置，纯代码压力结果保留，真实保真探测未执行。');
    const fixture = longDiscussion(24);
    fixture.discussion.contextSummary =
      '故意损坏的摘要：全员同意接入敏感库，试点统一改为4周，审计失败也不停。此摘要不可信。';
    const full = buildContext(fixture, [], 100000),
      compressed = buildContext(fixture, [], 12000);
    const longFixture = longDiscussion(600);
    longFixture.discussion.contextSummary = fixture.discussion.contextSummary;
    const longCompressed = buildContext(longFixture, [], 12000);
    const questions = [
      { id: 'scope', question: '最早发言规定试点多久、允许接入什么？' },
      { id: 'veto', question: '权限审计未通过时的反对与暂停条件是什么？' },
      { id: 'maintenance', question: '人工维护上限和退出条件是什么？' },
      { id: 'stages', question: '初始试点与后续收益评估的阶段关系是什么？' },
    ];
    const results = [];
    for (const [variant, context] of [
      ['full', full],
      ['compressed', compressed],
      ['compressed-600', longCompressed],
    ] as const) {
      console.info(
        `真实模型保真探测：${variant}，输入${JSON.stringify(context).length}字符（合成资料）`,
      );
      const result = await model.run('retention', { ...context, questions }, retentionSchema);
      const checks = {
        answers: questions.every((q, i) =>
          result.answers.some(
            (a) =>
              a.questionId === q.id &&
              a.sourceMessageId === `m${i + 1}` &&
              a.quote === criticalQuotes[i],
          ),
        ),
        disputes:
          JSON.stringify([...result.unresolvedDisagreementIds].sort()) ===
          JSON.stringify(
            fixture.insights
              .filter((i) => i.kind === 'disagreement')
              .map((i) => i.id)
              .sort(),
          ),
      };
      results.push({ variant, inputChars: JSON.stringify(context).length, result, checks });
    }
    report.realProbe = {
      fixtureMessages: 24,
      longFixtureMessages: 600,
      comparison:
        'full/compressed使用同一24条资料；compressed-600增加无关历史，关键条件和分歧保持相同。',
      deliberatelyCorruptSummary: true,
      results,
      equivalent: results.every((r) => r.checks.answers && r.checks.disputes),
    };
  }
  report.passed =
    cases.every((c) => Object.values(c.checks).every(Boolean)) &&
    (!report.realProbe || (report.realProbe as { equivalent: boolean }).equivalent);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.realProbe = {
    status: 'incomplete',
    reason: error instanceof Error ? error.message : '未知错误',
  };
  report.passed = false;
  process.exitCode = 1;
}
writeFileSync(output, JSON.stringify(report, null, 2));
console.info(JSON.stringify(report));
