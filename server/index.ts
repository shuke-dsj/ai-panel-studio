import { Store } from './db.js';
import { createApp } from './app.js';
import { configuredModel, settings } from './config.js';
import { seedCurated } from './seed.js';
import { seedReviewedExamples } from './examples.js';
const store = new Store(settings.database);
seedCurated(store);
seedReviewedExamples(store);
const model = configuredModel();
const { app, engine } = await createApp(store, model, {
  serveStatic: true,
  contextBudget: settings.contextBudget,
});
await app.listen({ port: settings.port, host: '127.0.0.1' });
console.info(
  `Panel API: http://127.0.0.1:${settings.port} | mode=${model.mode} | model configured=${model.configured}`,
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  for (const id of engine.jobs.keys()) {
    const d = store.get(id);
    if (d.status === 'running') engine.pause(id);
  }
  await Promise.allSettled([...engine.jobs.values()]);
  await app.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
