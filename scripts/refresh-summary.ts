import { Store } from '../server/db.js';
import { settings } from '../server/config.js';
import { refreshArchivedSummary } from '../server/refresh-summary.js';
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('请指定已结束讨论ID');
const store = new Store(settings.database);
try {
  for (const id of ids) {
    const s = refreshArchivedSummary(store, id);
    console.info(
      JSON.stringify({
        id,
        summaryVersions: s.discussion.summaryHistory?.length ?? 0,
        modelCalls: s.discussion.modelCalls,
        consensus: s.insights.filter((i) => i.kind === 'consensus').length,
      }),
    );
  }
} finally {
  store.close();
}
