import { Store } from '../server/db.js';
import { settings } from '../server/config.js';
import { seedCurated } from '../server/seed.js';
import { seedReviewedExamples } from '../server/examples.js';
const store = new Store(settings.database);
seedCurated(store);
seedReviewedExamples(store);
console.info(
  `SQLite initialized: ${store.list().length} discussions. Reviewed model archives and curated examples have separate labels.`,
);
store.close();
