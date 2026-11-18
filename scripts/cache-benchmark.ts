import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { configuredModel } from '../server/config.js';
import { buildContext } from '../server/context.js';
import { buildModelMessages, type RequestLayout } from '../server/request-layout.js';
import { retentionSchema, reviewSchema } from '../server/schemas.js';
import { longDiscussion, criticalQuotes } from '../tests/fixtures/long-discussion.js';

const reportPath = process.env.CACHE_REPORT_PATH ?? 'docs/evidence/cache-benchmark.json';
const id = 'cache-probe-' + randomUUID();
const s = longDiscussion(24);
s.discussion.id = id;
s.discussion.maxTurns = 48;
s.participants.forEach((p) => (p.discussionId = id));
s.messages.forEach((m) => (m.discussionId = id));
const contexts = [buildContext(s, [], 56000)];
for (const [i, text] of [
  '按当前原文，权限失败仍须暂停，未决分歧不视为关闭。',
  '2周试点与后续4周评估分开，维护上限仍为每月低于4人时。',
].entries()) {
  s.messages.push({
    ...s.messages[0],
    id: 'm' + (25 + i),
    seq: 25 + i,
    participantId: i ? 'c' : 'b',
    text,
  });
  s.discussion.turns = 25 + i;
  contexts.push(buildContext(s, [], 56000));
}
const questions = [
  { id: 'scope', question: '最早发言规定试点多久、允许接入什么？' },
  { id: 'veto', question: '最早的权限审计未通过反对与暂停条件是什么？' },
  { id: 'maintenance', question: '最早规定的人工维护上限和退出条件是什么？' },
  { id: 'stages', question: '最早规定的初始试点与后续收益评估的阶段关系是什么？' },
];
const cases = [
  { task: 'retention' as const, input: { ...contexts[0], current: s.participants[1], questions } },
  { task: 'retention' as const, input: { ...contexts[1], current: s.participants[2], questions } },
  {
    task: 'review' as const,
    expectedKind: 'scope',
    input: {
      ...contexts[1],
      purpose: 'speech-boundary',
      speakerId: 'a',
      candidate: '我们已批准接入敏感库。',
    },
  },
  {
    task: 'review' as const,
    expectedKind: 'timeline',
    input: {
      ...contexts[1],
      purpose: 'speech-boundary',
      speakerId: 'a',
      candidate: '本次初始试点已经统一改为4周。',
    },
  },
  { task: 'retention' as const, input: { ...contexts[2], current: s.participants[3], questions } },
];
type Entry = {
  task: string;
  attempt: number;
  durationMs: number;
  error?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  cache?: { status: string; hitTokens?: number; missTokens?: number };
};
const reports = [] as {
  layout: RequestLayout;
  attempts: Entry[];
  cases: unknown[];
  qualityPassed: boolean;
  usage: ReturnType<typeof totals>;
}[];
function totals(entries: Entry[]) {
  const measured = entries.filter((e) => e.cache?.status === 'reported');
  const hit = measured.reduce((n, e) => n + (e.cache?.hitTokens ?? 0), 0);
  const miss = measured.reduce((n, e) => n + (e.cache?.missTokens ?? 0), 0);
  return {
    attempts: entries.length,
    measuredAttempts: measured.length,
    promptTokens: entries.reduce((n, e) => n + (e.usage?.prompt_tokens ?? 0), 0),
    completionTokens: entries.reduce((n, e) => n + (e.usage?.completion_tokens ?? 0), 0),
    hitTokens: measured.length ? hit : null,
    missTokens: measured.length ? miss : null,
    hitRate: hit + miss ? hit / (hit + miss) : null,
  };
}
try {
  for (const layout of ['legacy', 'prefix'] as const) {
    const attempts: Entry[] = [],
      results: unknown[] = [];
    const model = configuredModel(true, {
      requestLayout: layout,
      logger: (entry) => attempts.push(entry as Entry),
    });
    if (!model.configured) throw new Error('真实模型未配置，不使用演示替代。');
    let qualityPassed = true;
    for (const [index, c] of cases.entries()) {
      const wire = buildModelMessages(c.task, c.input, '', layout);
      const preserved =
        layout === 'legacy'
          ? isDeepStrictEqual(JSON.parse(wire[1].content), c.input)
          : isDeepStrictEqual(
              { ...JSON.parse(wire[1].content), ...JSON.parse(wire[3].content) },
              c.input,
            );
      if (!preserved) throw new Error('请求材料不完整，终止探测。');
      if (c.task === 'retention') {
        const output = await model.run(c.task, c.input, retentionSchema);
        const checks = {
          payloadPreserved: preserved,
          conditionsAndSources: questions.every((q, i) =>
            output.answers.some(
              (a) =>
                a.questionId === q.id &&
                a.quote === criticalQuotes[i] &&
                a.sourceMessageId === 'm' + (i + 1),
            ),
          ),
          unresolvedDispute:
            JSON.stringify([...output.unresolvedDisagreementIds].sort()) ===
            JSON.stringify(['audit-dispute']),
        };
        qualityPassed &&= Object.values(checks).every(Boolean);
        results.push({ index, task: c.task, checks, output });
      } else {
        const output = await model.run(c.task, c.input, reviewSchema);
        const checks = {
          payloadPreserved: preserved,
          rejectsExpectedViolation: output.issues.some((i) => i.kind === c.expectedKind),
          literalCandidateQuotes: output.issues.every((i) => c.input.candidate.includes(i.quote)),
        };
        qualityPassed &&= Object.values(checks).every(Boolean);
        results.push({ index, task: c.task, expectedKind: c.expectedKind, checks, output });
      }
      console.info(
        JSON.stringify({ layout, case: index + 1, task: c.task, usage: totals(attempts) }),
      );
    }
    reports.push({ layout, attempts, cases: results, qualityPassed, usage: totals(attempts) });
  }
  const [legacy, prefix] = reports;
  const comparable = reports.every(
    (r) => r.usage.measuredAttempts === r.usage.attempts && r.usage.attempts > 0,
  );
  const missReduction =
    comparable && legacy.usage.missTokens! > 0
      ? 1 - prefix.usage.missTokens! / legacy.usage.missTokens!
      : null;
  const report = {
    testedAt: new Date().toISOString(),
    fixture: '公开合成材料，未读取历史用户讨论；同一24条历史后追加两条，跨角色/阶段/任务对照。',
    method:
      '每种布局5次逻辑调用：3次原文保真、1次范围审查、1次时间线审查；无额外预热或跳过质量步骤；所有重试计入用量，命中率以Token总量加权。先legacy后prefix，单轮非随机顺序。',
    reports,
    comparison: { comparable, missReduction, qualityPassed: reports.every((r) => r.qualityPassed) },
    passed:
      comparable &&
      missReduction !== null &&
      missReduction > 0 &&
      reports.every((r) => r.qualityPassed),
    limitation:
      '服务端缓存为best effort；这是合成长材料的单轮对照，不代表每场讨论或冷启动均达到该命中率。',
  };
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.info(
    JSON.stringify({ output: reportPath, comparison: report.comparison, passed: report.passed }),
  );
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        reports,
        status: 'incomplete',
        error: error instanceof Error ? error.message : '探测失败',
      },
      null,
      2,
    ),
  );
  console.error(error instanceof Error ? error.message : '探测失败');
  process.exitCode = 1;
}
