import { mkdirSync, writeFileSync } from 'node:fs';
import { configuredModel } from '../server/config.js';
import { buildContext } from '../server/context.js';
import { speechSchema } from '../server/schemas.js';
import { longDiscussion } from '../tests/fixtures/long-discussion.js';
const attempts: unknown[] = [];
const model = configuredModel(true, { logger: (entry) => attempts.push(entry) });
const s = longDiscussion(8),
  context = buildContext(s, [], 28000);
const path = 'docs/evidence/cache-feedback-quality.json';
try {
  const result = await model.run(
    'speech',
    {
      ...context,
      current: s.participants[0],
      directive: '按已公开原文继续串场，追问未决的验收条件，不替用户批准。',
      corrections: [
        {
          kind: 'scope',
          quote: '退款负责人',
          reason: '未公开候选把退出负责人误写成退款负责人，正式输出应改正，不能引入其他角色。',
          conflictsWith: ['topic'],
        },
      ],
    },
    speechSchema,
  );
  const checks = {
    nonEmpty: result.text.trim().length > 0,
    noUnpublishedDraftLeak: !/退款负责人|候选发言|内部审查|草稿|上一版|刚才误写/.test(result.text),
    validReference: !result.replyTo || s.messages.some((m) => m.id === result.replyTo),
    prefixTransport: attempts.every(
      (a) => (a as { requestLayout: string }).requestLayout === 'prefix',
    ),
  };
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        fixture: '公开合成材料与强制内部错稿反馈，未使用用户历史讨论',
        checks,
        passed: Object.values(checks).every(Boolean),
        result,
        attempts,
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify({ checks, output: path }));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} catch (error) {
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        status: 'incomplete',
        error: error instanceof Error ? error.message : '定向验证失败',
        attempts,
      },
      null,
      2,
    ),
  );
  console.error(error instanceof Error ? error.message : '定向验证失败');
  process.exitCode = 1;
}
