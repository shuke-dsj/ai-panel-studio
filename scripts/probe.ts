import { configuredModel } from '../server/config.js';
import { summarySchema } from '../server/schemas.js';
const model = configuredModel(true);
try {
  await model.run(
    'summary',
    {
      topic: '连通性验证',
      messages: [],
      insights: [],
      directive: '说明暂无实际讨论，不得虚构结论。',
    },
    summarySchema,
  );
  console.info(
    'PASS: real model connectivity and validated JSON output. No full model output or key recorded.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Probe failed');
  process.exitCode = 1;
}
