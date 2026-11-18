import type { Store } from './db.js';
import { projectInsights } from './insight-ledger.js';
import { renderConciseSummary, renderGroundedSummary } from './summary.js';
/** Local maintenance: re-render already persisted evidence, without model calls. */
export function refreshArchivedSummary(store: Store, id: string) {
  const before = store.snapshot(id),
    d = before.discussion;
  if (d.status !== 'completed' || !d.insightLedger) throw new Error('只允许刷新带账本的已结束记录');
  const current = { ...before, insights: projectInsights(d.insightLedger) };
  const summary = renderConciseSummary(current, [], d.endReason ?? 'user');
  const summaryDetails = renderGroundedSummary(current, []);
  if (summary === d.summary && summaryDetails === d.summaryDetails) return before;
  store.replaceInsights(
    id,
    current.insights,
    d.contextSummary,
    store.checkpoint(id),
    d.insightLedger,
    {
      summary,
      summaryDetails,
      summaryHistory: [
        ...(d.summaryHistory ?? []),
        {
          cycle: d.cycle ?? 1,
          topic: d.effectiveTopic ?? d.topic,
          summary: d.summary ?? '',
          details: d.summaryDetails ?? null,
          createdAt: new Date().toISOString(),
          revisionReason: '根据已保存账本刷新，不调用模型',
        },
      ],
    },
  );
  return store.snapshot(id);
}
