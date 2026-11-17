import { Store } from '../server/db.js';
import { settings } from '../server/config.js';
import { seedCurated } from '../server/seed.js';
const store=new Store(settings.database);seedCurated(store);console.info(`SQLite initialized: ${store.list().length} discussions. Curated examples are human-authored, not real model evidence.`);store.close();
